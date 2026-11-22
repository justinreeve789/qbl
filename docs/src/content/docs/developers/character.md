---
title: "Characters"
host:
  who: pinta
  says: "Characters in JSON: how a picture becomes someone you can talk to."
  side: right
---

Characters are NPCs associated with a scenario.

### Primary Attributes
Parameter | Type        | Default | Description
--------- |-------------|---------| -----------
id | int         |         | Character id
scenario_id | int         |         | The scenario the character is associated with.
name | string          |               | Name of the character.                                                                                                                                                                    
conditions | array       |         | A list of conditions which must be met before the character exists.
