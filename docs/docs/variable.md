# Global Variables
Custom global variables can be declared by a user, and can be used throughout the project by storing numbers and strings. They are particularly useful when defining conditions for events and actions. A certain number of global variables are reserved for system use. Reserved variables are used for reference by the user in their scripting, and can be changed via actions. All reserved variables are prefixed with “QBL.”

### Primary Attributes
Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
id | int |  | variable id
scenario_id | int |  | The scenario id the variable is associated with.
variable_name | string |  | The name of the variable; this cannot be any of the reserved variables.
default_value | string |  | The initial value of the variable when the scenario first loads.

## Reserved Variables
Value | Description                                                                                                                                                                                                                                                                                             
----- |---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
QBLHotspotCoordinates | If a hotspot is currently executing, this is the XY coordinates of the hotspot.                                                                                                                                                                                                                         
QBLScenarioLanguage | Two-digit country code specifying the currently selected language for the scenario.                                                                                                                                                                                                                     
QBLTimeElapsed | The number of seconds the user has currently spent in the scenario.                                                                                                                                                                                                                                     | The number of seconds the user has currently spent in the scenario.
QBLVideoPlaying | If the current scene has a video, this indicates whether or not that video is currently playing. This could be useful if a scene needs to end when the video is finished; a start event could be created that continually checks for the video to be finished, and jumps to the next scene when it has. 
QBLVideoTimeIndex | If the current scene has a video, this is the time index, by number of seconds, the video is currently at.                                                                                                                                                                                              
