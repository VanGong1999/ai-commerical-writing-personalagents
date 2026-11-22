import {abortableDelay} from './requestRetry.js';

/** Backoff is part of the controlled run, including pause/stop/lease fencing. */
export async function waitBeforeJobRetry(ms,{signal,api,jobId,runId,owner,leaseVersion,checkpoint,publish,notifyTerminal}) {
  try {await abortableDelay(ms,signal);return true;} catch(error) {
    if(!signal?.aborted) throw error;
    const reason=String(signal.reason?.message || signal.reason || '');
    if(reason==='lease_lost') return false;
    if(reason==='paused') {
      await api.releaseLease(runId,{owner,leaseVersion,state:'paused',checkpoint});
      publish?.({type:'done',status:'paused'});
      return false;
    }
    if(reason==='cancelled' || reason==='interrupted') {
      const status=reason==='cancelled'?'cancelled':'queued';
      // Fence the run before changing the job or notifying dependents.
      await api.patchRunStatus(runId,{status,leaseVersion});
      await api.patchJobStatus(jobId,{status});
      if(status==='cancelled') await notifyTerminal?.(api,jobId,runId,status,'用户停止任务');
      // Interrupted directives remain unread in the mailbox for the resumed run.
      publish?.({type:'done',status});
      return false;
    }
    throw error;
  }
}
