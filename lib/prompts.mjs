// Parent-orchestrator prompts (Executor Skill v2.0.0 contract).
import { SKILL_WORKFLOW } from "./const.mjs";

export function runPrompt({ title, goal, acceptance, workspace, waitfor, markerDir }) {
  const accept = acceptance.map((a) => "- " + a).join("\n");
  const waitRule = waitfor === "completion"
    ? [
        "3. Wait for the workflow to COMPLETE (subagent_wait). Do not create any Mission decision; the task must not require a user decision.",
        "4. After completion, verify the Mission reached terminal state with the strict-fork reviewer executed (review-1 child present).",
      ].join("\n")
    : [
        "3. Wait until the worker reaches contact_supervisor(reason:\"need_decision\") (subagent_wait).",
        "4. Persist EXACTLY ONE open decision on the SAME Mission via subagent({action:\"mission.update\", missionId, missionUpdate:{decisions:[{title, prompt:<the worker's question>}]}}) and capture the generated decision id. Never create a second decision.",
      ].join("\n");
  return [
    "You are the parent orchestrator of the Executor Skill (executor, v2.0.0). Follow its orchestration contract exactly. This session is driven non-interactively by executor_harness; there is no interactive user. Diagnose-before-delegation is waived: the task below is self-contained.",
    "",
    "TASK TITLE: " + title,
    "GOAL: " + goal,
    "ACCEPTANCE CONTRACT:",
    accept,
    "WORKSPACE: " + workspace,
    "SIDE-EFFECT RULE: write only inside " + markerDir + " (create it if missing). Never touch production files under /home/ubuntu/cc-connect-workspace or any config.",
    "Do NOT create a SPEC.md. Do NOT build a second task/checkpoint database.",
    "",
    "Execute now, in this single turn:",
    "1. Create the durable Mission first: subagent({action:\"mission.create\", mission:{title:<title>, objective:<goal + acceptance + side-effect rule>}}) and capture missionId.",
    "2. Launch the workflow async and bound to that Mission: subagent({workflowScriptPath:" + JSON.stringify(SKILL_WORKFLOW) + ", missionId, cwd:" + JSON.stringify(workspace) + ", async:true}).",
    waitRule,
    "5. End your turn with EXACTLY ONE final line of the form (nothing after it):",
    'HARNESS_REPORT:{"missionId":"...","decisionId":"..." or null,"workflowRunId":"...","childRunIds":[...],"missionStatus":"needs_decision" or "completed" or "failed","sessionFile":"' + "<your session file>" + '"}',
    waitfor === "completion" ? "Do not create any decision." : "Do NOT resolve the decision and do NOT run the reviewer in this turn; end the turn right after persisting the decision.",
    "If any step cannot be proven safe, fail closed: report HARNESS_REPORT with missionStatus:\"failed\" and a one-line reason.",
  ].join("\n");
}

export function answerPrompt({ missionId, decisionId, question, answer }) {
  return [
    "You are the SAME parent orchestrator of the Executor Skill (executor, v2.0.0), continuing Mission " + missionId + " in this SAME session. The user has now answered the open decision.",
    "",
    "OPEN DECISION id: " + decisionId,
    "ORIGINAL QUESTION: " + question,
    "USER ANSWER: " + answer,
    "",
    "Follow Executor Skill step 6 exactly, in this single turn:",
    "1. Resolve the SAME decision id (never a new one): subagent({action:\"mission.resolve-decision\", missionId:" + JSON.stringify(missionId) + ", id:" + JSON.stringify(decisionId) + ", summary:<the user answer>}).",
    "2. Deliver the answer to the waiting worker:",
    "   a. If the original supervisor route is still live, reply natively (subagent_supervisor reply).",
    "   b. Otherwise resume the retained child ONLY if Mission/retained-child status explicitly proves resumable (subagent({action:\"resume\", id:<retained child run id>})). Never guess resumability; never re-run a completed step; never create a replacement Mission. If not provable, fail closed.",
    "3. Continue the SAME Mission lineage until the post-decision workflow step and the strict-fork Reviewer actually run (subagent_wait).",
    "4. End your turn with EXACTLY ONE final line:",
    'HARNESS_REPORT:{"missionId":"' + missionId + '","decisionId":"' + decisionId + '","missionStatus":"completed"|"failed","reviewRounds":<n>,"final":"<one-line verdict>"}',
    "If the upstream error 'This extension ctx is stale after session replacement or reload' appears, STOP immediately and report HARNESS_REPORT with missionStatus:\"failed\" and the exact error text.",
  ].join("\n");
}
