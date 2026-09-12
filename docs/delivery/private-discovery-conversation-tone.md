# Private discovery: warmer conversation

Status: follow-up requested by the product owner on 2026-09-12.
Related work: [PR #218](https://github.com/cill-i-am/meal-planner/pull/218), Stage 2 adaptive discovery.

The product owner reviewed the completed dependant-and-fallback example and found it acceptable against the criteria, but described the assistant's responses as robotic. They requested more empathy. This is qualitative feedback; no numerical ratings were supplied.

Improve the interview's acknowledgements, follow-up questions and review invitations so it feels attentive and natural:

- Briefly acknowledge the person's actual circumstances and practical burden.
- Use warm, plain language and questions that follow naturally from their answer.
- Reduce repeated administrative wording about profile proposals and private conversation context.
- Avoid stock sympathy, excessive reassurance, invented feelings or unnecessary extra conversation.

Preserve accurate attribution, uncertainty, privacy and explicit confirmation. Warmth must not imply that an unconfirmed proposal has already been saved. Application-rendered wording is part of this follow-up; changing the model prompt alone will not address all of the repeated language.

Review representative conversations with the product owner after the tone changes. This note requests future work and does not change the implementation currently under evaluation.
