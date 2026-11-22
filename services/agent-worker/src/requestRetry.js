/** Wait without holding up pause/stop handling. Never retry ambiguous mutations. */
export function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('aborted'));
  return new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);reject(signal.reason || new Error('aborted'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},ms);
    signal?.addEventListener('abort',onAbort,{once:true});
  });
}

export async function retryRejectedModelRequest(request, {
  signal, maxWaitMs=120000, maxAttempts=12, wait=abortableDelay, now=Date.now, random=Math.random, onRetry,
}={}) {
  const started=now();
  for(let attempt=0;;attempt++) {
    if(signal?.aborted) throw signal.reason || new Error('aborted');
    try {return await request();} catch(error) {
      const rejected=(error?.status===429 || error?.source==='local') && error?.retryable!==false;
      if(!rejected || attempt+1>=maxAttempts) throw error;
      const base=Math.max(1,Number(error.retryAfter || 1)*1000);
      const delay=base + Math.floor(random()*Math.min(1000,base*0.1));
      if(now()-started+delay>maxWaitMs) throw error;
      onRetry?.({attempt:attempt+1,delayMs:delay,source:error.source || 'provider',code:error.code});
      await wait(delay,signal);
    }
  }
}

export function jobRetryDecision(error,attempts,maxAttempts) {
  const local=error?.source==='local' && error?.retryable!==false;
  return {retry:error?.retryable!==false && (local || attempts<maxAttempts),nextAttempts:local?attempts:attempts+1,local};
}
