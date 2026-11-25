---
title: "Variable"
description: "Sets or changes a global variable."
---

`type`: `variable`

Set or modify a global variable.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
name | string |  | A global variable that has been defined at the project level. Only dynamic variables by a variable action.
operator | string |  | One of six data manipulation operators to perform on the variable: set, +, -, *, /, %
operand | multiple |  | A number (integer or decimal), or a string, for which the variable is manipulated according to the operator.

## Operator
Value | Description
----- | -----------
set | Assign the variable to the value specified in operand.
+ | Add the numeric variable by the value specified in operand. If the operand is non-numeric, this does nothing.
- | Subtract the numeric variable by the value specified in operand. If the operand is non-numeric, this does nothing.
* | Multiply the numeric variable by the value specified in operand. If the operand is non-numeric, this does nothing.
  / | Divide the numeric variable by the value specified in operand. if the operand is non-numeric, this does nothing.
  % | Modulo the numeric variable by the value specified in operand. if the operand is non-numeric, this does nothing.
  random | Generate a random whole number from 0 up to and including the operand, and assign it to the variable. For example, an operand of 20 gives a number from 0 to 20. A decimal operand is rounded down, and a negative one gives 0. If there is no operand, the number is between 1 and 1000000000 (the original behaviour); narrow that with a following variable action using modulus (%).
