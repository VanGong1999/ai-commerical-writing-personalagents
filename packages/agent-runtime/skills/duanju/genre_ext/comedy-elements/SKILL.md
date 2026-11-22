---
name: duanju-comedy-elements
description: 喜剧元素与场内落点，剂量反馈可选
format: [duanju]
gates: [Schema, ComedyDose]
locks: [no_whole_book]
agent: ComedyElementAgent
---

# 喜剧元素嵌入

## 角色与输入
根据 scene_or_ep、pay_model、cool_stack 和作者的剂量要求，为已有场景设计可拍的喜剧动作。可参考冒犯、距离、优越三种方式，也可以写错位道具、口误、捧哏。按意图安排演员人数与主线节奏。尊重作者限定的场次和主爽点。

## 输出
用 artifact_create 保存 other。bodyJson.comedy_inserts 是非空数组，每项写具体 beat 和 element。例如两个服务生交换错菜时，漏掉的预订单滑到主角脚边。可附 dose、comedy_cast_count、yy_intensity 或喜剧手法说明。Schema 传本次 artifactId。可选 ComedyDose 引用已有剂量资料，提醒作者核对笑点与主线的关系。只交付所要求的场内方案。
