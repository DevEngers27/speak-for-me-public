// Independent table/field/index contract copied from 03 §§3.5–3.12.
export const CONTRACT = {
  "users": {
    "fields": [
      "tokenIdentifier",
      "displayName",
      "isTestAccount",
      "createdAt",
      "updatedAt"
    ],
    "indexes": {
      "by_tokenIdentifier": [
        "tokenIdentifier"
      ]
    }
  },
  "rooms": {
    "fields": [
      "scenarioKey",
      "scenarioVersion",
      "title",
      "timeZone",
      "localDate",
      "status",
      "constraintsVersion",
      "nextProposalVersion",
      "nextRunNo",
      "writeSeq",
      "currentRunId",
      "executionId",
      "followsExecutionId",
      "createdBy",
      "provenance",
      "createdAt",
      "openedAt",
      "executedAt",
      "closedAt"
    ],
    "indexes": {
      "by_followsExecutionId": ["followsExecutionId"],
      "by_createdBy": [
        "createdBy"
      ],
      "by_status": [
        "status"
      ]
    }
  },
  "members": {
    "fields": [
      "roomId",
      "userId",
      "role",
      "displayName",
      "joinedVia",
      "inviteId",
      "joinedAt"
    ],
    "indexes": {
      "by_room_user": [
        "roomId",
        "userId"
      ],
      "by_room_role": [
        "roomId",
        "role"
      ],
      "by_user": [
        "userId"
      ]
    }
  },
  "invites": {
    "fields": [
      "roomId",
      "role",
      "mode",
      "invitedEmail",
      "tokenHash",
      "status",
      "expiresAt",
      "createdBy",
      "acceptedBy",
      "acceptedAt",
      "createdAt"
    ],
    "indexes": {
      "by_room_role": [
        "roomId",
        "role"
      ],
      "by_email_status": [
        "invitedEmail",
        "status"
      ],
      "by_tokenHash": [
        "tokenHash"
      ]
    }
  },
  "briefs": {
    "fields": [
      "roomId",
      "role",
      "version",
      "hardFields",
      "softFields",
      "disclosures",
      "source",
      "humanRequestId",
      "confirmedBy",
      "confirmedAt",
      "provenance"
    ],
    "indexes": {
      "by_room_role_version": [
        "roomId",
        "role",
        "version"
      ]
    }
  },
  "sharedFacts": {
    "fields": [
      "roomId",
      "fromRole",
      "field",
      "seq",
      "value",
      "audience",
      "briefVersion",
      "source",
      "humanRequestId",
      "createdBy",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_room_from_field": [
        "roomId",
        "fromRole",
        "field",
        "seq"
      ]
    }
  },
  "catalogItems": {
    "fields": [
      "roomId",
      "itemKey",
      "revision",
      "editNo",
      "status",
      "kind",
      "title",
      "priceCents",
      "leadDays",
      "taskTemplates",
      "confirmedBy",
      "confirmedAt",
      "createdBy",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_room_item": [
        "roomId",
        "itemKey",
        "revision",
        "editNo"
      ]
    }
  },
  "ledgerEntries": {
    "fields": [
      "roomId",
      "kind",
      "amountCents",
      "executionId",
      "recordedByUserId",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_room_kind": [
        "roomId",
        "kind"
      ]
    }
  },
  "constraintRevisions": {
    "fields": [
      "roomId",
      "version",
      "previousVersion",
      "cause",
      "actorUserId",
      "sourceRefs",
      "localDate",
      "supersededRunId",
      "staleProposalId",
      "createdAt"
    ],
    "indexes": {
      "by_room_version": [
        "roomId",
        "version"
      ]
    }
  },
  "runs": {
    "fields": [
      "roomId",
      "runNo",
      "status",
      "cause",
      "constraintsVersionAtStart",
      "agentMode",
      "roundNo",
      "maxRounds",
      "roundsExtended",
      "activeTurnSeq",
      "nextTurnSeq",
      "currentProposalId",
      "attemptCount",
      "maxAttempts",
      "reservedMicroUsd",
      "spentMicroUsd",
      "spendCapMicroUsd",
      "previousRunId",
      "startedBy",
      "endedReason",
      "lastFailure",
      "provenance",
      "startedAt",
      "endedAt"
    ],
    "indexes": {
      "by_room_runNo": [
        "roomId",
        "runNo"
      ],
      "by_status": [
        "status"
      ]
    }
  },
  "turns": {
    "fields": [
      "roomId",
      "runId",
      "turnSeq",
      "roundNo",
      "role",
      "kind",
      "status",
      "constraintsVersion",
      "baseProposalId",
      "baseProposalVersion",
      "candidateSnapshot",
      "allowedActions",
      "promptVersion",
      "currentAttemptNo",
      "waitingReason",
      "beginFnId",
      "retryOfTurnId",
      "result",
      "outcome",
      "createdAt",
      "completedAt"
    ],
    "indexes": {
      "by_run_turnSeq": [
        "runId",
        "turnSeq"
      ]
    }
  },
  "attempts": {
    "fields": [
      "roomId",
      "runId",
      "turnId",
      "attemptNo",
      "role",
      "origin",
      "status",
      "provenance",
      "model",
      "effort",
      "maxTokens",
      "schemaVersion",
      "protocolVersion",
      "promptVersion",
      "reservedDay",
      "retryNote",
      "staleGuard",
      "httpStatus",
      "retryAfterMs",
      "rationaleTruncated",
      "actionFnId",
      "watchdogFnId",
      "watchdogArmCount",
      "deadlineAt",
      "reservedMicroUsd",
      "usage",
      "stopReason",
      "stopCategory",
      "requestId",
      "messageId",
      "responseModel",
      "latencyMs",
      "costMicroUsd",
      "priceTableAsOf",
      "lateUsage",
      "errorCode",
      "issuePaths",
      "move",
      "outputBytes",
      "rawOutputRef",
      "startedAt",
      "finishedAt"
    ],
    "indexes": {
      "by_turn": [
        "turnId",
        "attemptNo"
      ],
      "by_run": [
        "runId"
      ],
      "by_status_deadline": [
        "status",
        "deadlineAt"
      ],
      "by_room": [
        "roomId"
      ]
    }
  },
  "rawOutputs": {
    "fields": [
      "attemptId",
      "roomId",
      "text",
      "truncated",
      "createdAt",
      "expiresAt"
    ],
    "indexes": {
      "by_attempt": [
        "attemptId"
      ],
      "by_expiresAt": [
        "expiresAt"
      ]
    }
  },
  "proposals": {
    "fields": [
      "roomId",
      "runId",
      "version",
      "origin",
      "authorRole",
      "sourceTurnId",
      "sourceRequestId",
      "chosenBy",
      "candidateKey",
      "terms",
      "termsKey",
      "lines",
      "plannedTasks",
      "requiredApprovals",
      "createdAtConstraintsVersion",
      "status",
      "statusChangedAt",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_room_version": [
        "roomId",
        "version"
      ],
      "by_run": [
        "runId"
      ]
    }
  },
  "approvals": {
    "fields": [
      "roomId",
      "proposalId",
      "runId",
      "userId",
      "role",
      "kind",
      "decision",
      "seq",
      "boundConstraintsVersion",
      "boundTermsKey",
      "reasonKey",
      "note",
      "decidedAt"
    ],
    "indexes": {
      "by_proposal_user": [
        "proposalId",
        "userId",
        "seq"
      ],
      "by_run_decision": [
        "runId",
        "decision"
      ]
    }
  },
  "humanRequests": {
    "fields": [
      "roomId",
      "runId",
      "kind",
      "toRole",
      "questionKey",
      "topicKey",
      "sourceTurnId",
      "constraintsVersion",
      "options",
      "status",
      "expiresAt",
      "answeredBy",
      "answerOptionKey",
      "answeredAt",
      "closedReason",
      "closedAt",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_run_status": [
        "runId",
        "status"
      ],
      "by_room_status": [
        "roomId",
        "status"
      ],
      "by_status_expiresAt": [
        "status",
        "expiresAt"
      ]
    }
  },
  "executions": {
    "fields": [
      "roomId",
      "runId",
      "proposalId",
      "proposalVersion",
      "executionKey",
      "constraintsVersion",
      "termsKey",
      "approvalIds",
      "executedByUserId",
      "scenarioKey",
      "scenarioVersion",
      "amountCents",
      "committedBeforeCents",
      "committedAfterCents",
      "capCentsAtExecution",
      "provenance",
      "executedAt"
    ],
    "indexes": {
      "by_executionKey": [
        "executionKey"
      ],
      "by_room": [
        "roomId"
      ],
      "by_proposal": [
        "proposalId"
      ]
    }
  },
  "changeOrders": {
    "fields": [
      "roomId",
      "executionId",
      "proposalId",
      "proposalVersion",
      "number",
      "terms",
      "lines",
      "termsKey",
      "baselineCents",
      "priorApprovedDeltaCents",
      "amountBeforeCents",
      "deltaCents",
      "amountAfterCents",
      "constraintsVersion",
      "followsExecutionId",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_execution": [
        "executionId"
      ],
      "by_room": [
        "roomId"
      ]
    }
  },
  "tasks": {
    "fields": [
      "roomId",
      "executionId",
      "taskKey",
      "itemKey",
      "templateIndex",
      "title",
      "assigneeRole",
      "dueDate",
      "status",
      "doneByUserId",
      "doneAt",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_taskKey": [
        "taskKey"
      ],
      "by_execution": [
        "executionId"
      ],
      "by_room_assignee": [
        "roomId",
        "assigneeRole",
        "status"
      ]
    }
  },
  "opsFlags": {
    "fields": [
      "key",
      "draining",
      "changedAt",
      "changedBy"
    ],
    "indexes": {
      "by_key": [
        "key"
      ]
    }
  },
  "spendCounters": {
    "fields": [
      "scope",
      "day",
      "reservedMicroUsd",
      "spentMicroUsd",
      "attempts",
      "unknownCostAttempts"
    ],
    "indexes": {
      "by_scope_day": [
        "scope",
        "day"
      ]
    }
  },
  "events": {
    "fields": [
      "roomId",
      "payload",
      "restrictedRef",
      "actor",
      "actorUserId",
      "rateUser",
      "refs",
      "commitTs",
      "seq",
      "provenance",
      "createdAt"
    ],
    "indexes": {
      "by_room_order": [
        "roomId",
        "commitTs",
        "seq"
      ],
      "by_room_actor": [
        "roomId",
        "actorUserId",
        "rateUser"
      ]
    }
  }
} as const;
