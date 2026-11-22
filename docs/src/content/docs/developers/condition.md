---
title: "Conditions"
host:
  who: sam
  says: "Conditions decide what happens and when: compare a variable with a value, and the mission does the rest."
---

Conditions are placed on events or actions, and describe a global variable-based requirement that must be met before the actions in the event, or the action itself can be executed. If an action, startEvent or endEvent contains a condition that cannot be met, it will be bypassed entirely. If a hotspot contains a condition that cannot be met, looking or clicking within its radius will not trigger, or show any indication the hotspot is active (no hover animation).

### Primary Attributes
Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
id | int |  | condition id
event_id | int |  | The event id the condition is associated with.
type | string | variable | The type of condition. Currently, only “variable” is supported, and this refers to a global variable that has been defined at the scenario level.
variable | string |  | Either a custom global variable the user has been defined at the scenario level, or any of the reserved variables.
operator | string |  | One of five operators to perform on the variable, to test if the condition is true or false: =, !=, >, <
operand | multiple |  | A number (integer or decimal), or a string for which the variable is being evaluated.

## Variable Operators
Operator | Description
-------- | -----------
= | Test if variable equals variableOperand. If operand is a string, tests are case-insensitive.
!= | Test if variable does not equal operand; If operand is a string, tests are case-insensitive.
> | Test if variable is greater than operand. If operand is not numeric, the test will always return false.
< | Test if variable is less than operand. If operand is not numeric, the test will always return false.
