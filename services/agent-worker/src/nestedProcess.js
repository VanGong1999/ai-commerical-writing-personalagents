import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function nestedRunId(parent, depth) {
  return `nested_${parent || 'root'}_${depth}_${randomUUID()}`;
}

export function writeFrame(frame) {
  return new Promise((resolve, reject) => process.stdout.write(JSON.stringify(frame) + '\n',
    error => error ? reject(error) : resolve()));
}

function deadline(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) throw new Error('Invalid subagent timeout');
  return n;
}

// Only the owning worker talks to the lease API. Each descendant relays
// admissions over its direct parent channel, including nested forks.
export function parentAdmission(channel = process, timeoutMs = 30000) {
  const controller = new AbortController();
  const pending = new Map();
  function deny(reason = 'lease_unverified') {
    if (!controller.signal.aborted) controller.abort(new Error(reason));
    for (const settle of pending.values()) settle();
  }
  channel.on('disconnect', () => deny());
  channel.on('message', frame => {
    if (frame?.kind === 'control_abort') deny(frame.reason);
    if (frame?.kind !== 'admission_result') return;
    const settle = pending.get(frame.id);
    if (!settle) return;
    if (frame.ok !== true) deny(frame.reason);
    else settle();
  });
  function checkAdmission() {
    if (!channel.connected) deny();
    controller.signal.throwIfAborted();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => deny(), timeoutMs);
      pending.set(id, () => {
        clearTimeout(timer);
        pending.delete(id);
        if (controller.signal.aborted) reject(controller.signal.reason);
        else resolve();
      });
      try {
        channel.send({kind:'admission', id}, error => { if (error) deny(); });
      } catch { deny(); }
    });
  }
  return {signal:controller.signal, checkAdmission};
}

export async function runNestedProcess({args, env, publish, signal, checkAdmission,
  timeoutMs = process.env.AGENT_SUBAGENT_TIMEOUT_MS ?? 600000, graceMs = 2000}) {
  const timeout = deadline(timeoutMs);
  const grace = deadline(graceMs);
  const abortReason = () => signal?.reason?.name === 'AbortError' ? 'subagent cancelled' : signal?.reason?.message || 'subagent cancelled';
  if (signal?.aborted) throw new Error(abortReason());
  return new Promise((resolve,reject) => {
    const child = spawn(process.execPath,args,{env,stdio:['ignore','pipe','pipe','ipc']});
    let result, failure, escalation, buffer = '', stderr = '';
    function terminate(reason) {
      if (escalation) return;
      failure = new Error(reason);
      child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'),grace);
    }
    const send = frame => {
      if (!child.connected) return;
      try { child.send(frame, error => { if (error) terminate('lease_unverified'); }); }
      catch { terminate('lease_unverified'); }
    };
    child.on('message', async frame => {
      if (frame?.kind !== 'admission' || typeof frame.id !== 'string') return;
      try {
        if (!checkAdmission || failure) throw failure || new Error('lease_unverified');
        signal?.throwIfAborted();
        await checkAdmission();
        signal?.throwIfAborted();
        if (!failure) send({kind:'admission_result', id:frame.id, ok:true});
      } catch (error) {
        send({kind:'admission_result', id:frame.id, ok:false, reason:error.message});
      }
    });
    const abort = () => {
      if (escalation) return;
      failure = new Error(abortReason());
      send({kind:'control_abort', reason:failure.message});
      escalation = setTimeout(() => {
        escalation = undefined;
        terminate(failure.message);
      }, grace);
    };
    const timer = setTimeout(() => terminate('subagent timeout'),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.setEncoding('utf8').on('data',chunk => {
      buffer += chunk;
      let pos;
      while ((pos = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,pos);
        buffer = buffer.slice(pos+1);
        let frame;
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.kind === 'event') publish?.(frame.event);
        if (frame.kind === 'result') result = frame.result;
        if (frame.kind === 'error') failure ??= new Error(frame.message);
      }
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.once('error',error => { failure ??= error; });
    child.once('close',code => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal?.removeEventListener('abort',abort);
      if (failure) reject(failure);
      else if (code !== 0 || result === undefined) reject(new Error(`nested worker exited ${code}: ${stderr}`));
      else resolve(result);
    });
  });
}

export function nestedTerminalId(runId) {
  return runId + ':run_end';
}

// The child is already closed. Read the acknowledged outcome before adding
// synthetic evidence for termination that happened outside the child runtime.
export async function confirmNestedTerminal(child, readReplay, append) {
  const replay = await readReplay();
  if (!Array.isArray(replay?.steps)) throw new Error('Cannot confirm child terminal evidence');
  const proof = steps => steps.find(step => step.kind === 'run_end' && step.payload?.child_run_id === child.runId);
  const prior = proof(replay.steps);
  if (prior) return { ...child, status: prior.payload.status, exitReason: prior.payload.reason || prior.payload.status };
  await append({ child_run_id: child.runId, status: child.status, reason: child.exitReason,
    event_id: nestedTerminalId(child.runId) });
  const winner = proof((await readReplay())?.steps || []);
  if (!winner) throw new Error('Missing acknowledged child terminal evidence');
  return {...child, status: winner.payload.status, exitReason: winner.payload.reason || winner.payload.status};
}
