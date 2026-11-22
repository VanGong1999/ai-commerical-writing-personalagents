import test from "node:test";
import assert from "node:assert/strict";
import { manuscriptAccess, manuscriptSourceId, restoreSynopsis } from "../src/features/studio/manuscriptAccess.ts";
import { selectionRequest, applySelectionEdit } from "../src/features/references/selection.ts";
test("only a successful project read can open the editor", () => {
  assert.deepEqual(["pending","error","pending","success"].map(manuscriptAccess), ["loading","retry","loading","edit"]);
});
test("clearing a restored synopsis survives remount", () => {
  assert.equal(restoreSynopsis(null,"server"),"server");
  assert.equal(restoreSynopsis("","server"),"");
});
test("project drafts and a created artifact have distinct editable reference identities", () => {
  const a = manuscriptSourceId("A"), b = manuscriptSourceId("B");
  const ref = selectionRequest({kind:"draft",sourceId:a,projectId:"A"},"待改段落",0,2);
  assert.ok(a.length); assert.equal(applySelectionEdit(a,"待改段落",ref,"修改"),"修改段落");
  for(const id of [b,manuscriptSourceId("A","saved-1")]) assert.throws(()=>applySelectionEdit(id,"待改段落",ref,"错误"));
});
import { readManuscriptDraft, writeManuscriptDraft, clearSavedDraft } from "../src/features/studio/manuscriptAccess.ts";
test("draft survives switching projects; delayed save only clears its submitted revision", () => {
  const entries = new Map();
  const storage = {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
  writeManuscriptDraft(storage,"A","source",{text:"old",version:3});
  assert.equal(readManuscriptDraft(storage,"B","source"),null);
  writeManuscriptDraft(storage,"A","source",{text:"latest",version:3});
  clearSavedDraft(storage,"A","source","old");
  assert.deepEqual(readManuscriptDraft(storage,"A","source"),{text:"latest",version:3});
  clearSavedDraft(storage,"A","source","latest");
  assert.equal(readManuscriptDraft(storage,"A","source"),null);
});
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { firstManuscriptKey, reconcileFirstManuscript } from "../src/features/studio/manuscriptAccess.ts";
test("one delayed create stays pending for a remounted editor and transfers later draft text", async () => {
  const client = new QueryClient();
  const data = new Map();
  const storage = {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const source = manuscriptSourceId("A");
  const key = firstManuscriptKey("A",source);
  let resolve;
  const response = new Promise(finish=>{resolve=finish;});
  const mutation = new MutationObserver(client,{mutationKey:key,mutationFn:()=>response,onSuccess:()=>
    reconcileFirstManuscript(storage,"A",source,"submitted","new-id",1)});
  const completion = mutation.mutate();
  assert.equal(client.isMutating({mutationKey:firstManuscriptKey("B",manuscriptSourceId("B")),exact:true}),0);
  assert.equal(client.isMutating({mutationKey:firstManuscriptKey("A",source),exact:true}),1);
  writeManuscriptDraft(storage,"A",source,{text:"another edit"});
  resolve(); await completion;
  assert.equal(client.isMutating({mutationKey:key,exact:true}),0);
  assert.deepEqual(readManuscriptDraft(storage,"A","new-id"),{text:"another edit",version:1});
  assert.equal(readManuscriptDraft(storage,"A",source),null);
  client.clear();
});
test("quota failure during draft transfer retains the only copy of newer text", () => {
  const entries = new Map();
  const storage = {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
  writeManuscriptDraft(storage,"A","temporary",{text:"newer"});
  storage.setItem = () => { throw new Error("quota exceeded"); };
  assert.equal(reconcileFirstManuscript(storage,"A","temporary","submitted","created",1),false);
  assert.deepEqual(readManuscriptDraft(storage,"A","temporary"),{text:"newer"});
  assert.equal(readManuscriptDraft(storage,"A","created"),null);
});

import { observeDraftSave, finishDraftSave } from "../src/features/studio/manuscriptAccess.ts";
test("a delayed save advances the remounted editor's next edit and save", () => {
  const entries = new Map();
  const storage = {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
  const submitted = {text:"first edit", version:1};
  writeManuscriptDraft(storage,"project","character:A",submitted);
  const unmount = observeDraftSave("project","character:A",()=>assert.fail("unmounted editor notified"));
  unmount();
  let mounted = readManuscriptDraft(storage,"project","character:A");
  mounted = {...mounted, text:"edit after return"};
  writeManuscriptDraft(storage,"project","character:A",mounted);
  const unsubscribe = observeDraftSave("project","character:A",reconcile=>{ mounted = reconcile(mounted); });
  try {
    finishDraftSave(storage,"project","character:A",submitted,2);
    assert.deepEqual(mounted,{text:"edit after return",version:2});
    assert.deepEqual(readManuscriptDraft(storage,"project","character:A"),mounted);
    const nextSubmission = {...mounted,text:"edit again"};
    assert.equal(nextSubmission.version,2);
    finishDraftSave(storage,"project","character:A",submitted,2);
    assert.deepEqual(mounted,{text:"edit after return",version:2});
  } finally { unsubscribe(); }
});
