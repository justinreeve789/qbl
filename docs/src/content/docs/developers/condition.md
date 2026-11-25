---
title: "Conditions"
host:
  who: sam
  says: "Conditions decide what happens and when: compare a variable with a value, and the mission does the rest."
---

Conditions are placed on events or actions, and describe a global variable-based requirement that must be met before the actions in the event, or the action itself can be executed. If an action, startEvent or endEvent contains a condition that cannot be met, it will be bypassed entirely. If a hotspot contains a condition that cannot be met, looking or clicking within its radius will not trigger, or show any indication the hotspot is active (no hover animation).

:::note[Spec v2]
The runtime adds the operators `>=`, `<=`, `%` and `!%`: see [Variables](/docs/developers/extensions/variables/).
:::

## Primary Attributes
Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
id | int |  | condition id
event_id | int |  | The event id the condition is associated with.
type | string | variable | The type of condition. Currently, only “variable” is supported, and this refers to a global variable that has been defined at the scenario level.
variable | string |  | Either a custom global variable the user has been defined at the scenario level, or any of the reserved variables.
operator | string |  | The operator that tests the variable against the operand: =, !=, >, <, and the [extensions](/docs/developers/extensions/) >=, <=, % and !%
operand | multiple |  | A number (integer or decimal), or a string for which the variable is being evaluated.

## Variable Operators
Operator | Description
-------- | -----------
= | Test if variable equals variableOperand. If operand is a string, tests are case-insensitive.
!= | Test if variable does not equal operand; If operand is a string, tests are case-insensitive.
> | Test if variable is greater than operand. If operand is not numeric, the test will always return false.
< | Test if variable is less than operand. If operand is not numeric, the test will always return false.
>= | [ext] Test if variable is greater than or equal to operand. Numbers only.
<= | [ext] Test if variable is less than or equal to operand. Numbers only.
% | [ext] Test if variable is a whole multiple of operand: it divides by the operand with nothing left over (modulus 0). `turns % 2` holds on even turns, `visits % 3` on every third visit. 0 counts as a multiple. Numbers only; an operand of 0 never holds (the validator reports it).
!% | [ext] Test if variable is **not** a whole multiple of operand: `turns !% 2` holds on odd turns. Numbers only; an operand of 0 never holds.

Decimals work: `0.9 % 0.3` holds. Negative numbers too: `-6 % 3` holds.
