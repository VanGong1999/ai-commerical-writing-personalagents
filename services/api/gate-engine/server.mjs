// Pure, versioned JSON-lines RPC. No database, network, model, or tool execution.
import { createInterface } from 'node:readline';
import * as domain from '../../../packages/domain/src/gates.ts';
import * as basic from '../../../packages/agent-runtime/src/gates.ts';
import * as extended from '../../../packages/agent-runtime/src/gates.extended.ts';

const functions = Object.assign(Object.create(null), domain, basic, extended);
for await (const line of createInterface({input:process.stdin, crlfDelay:Infinity})) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.version !== 1 || !Number.isSafeInteger(request.id) ||
        !Array.isArray(request.args) || !Object.hasOwn(functions, request.function) ||
        typeof functions[request.function] !== 'function') throw new Error('Unsupported gate request');
    const result = functions[request.function](...request.args);
    process.stdout.write(JSON.stringify({version:1,id:request.id,ok:true,result})+'\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({version:1,id:request?.id ?? null,ok:false,
      error:{code:'gate_evaluation_error',message:String(error?.message || error)}})+'\n');
  }
}
