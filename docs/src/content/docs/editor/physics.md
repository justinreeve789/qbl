---
title: Physics experiments
description: Make a scene a physics experiment - balls that bounce, things that sink or float, pendulums, balances and bridges that break.
---

A scene can be a **physics experiment**. Things in it fall, roll, bounce, float, sink, swing and break as real things do, in metres, kilograms and seconds, and players work it with the pointer: they pick things up and drop them, take weights from a tray, press down on things, and build bridges beam by beam. What happens is measured on screen, and can move the mission along through variables and events like anything else.

The **Physics Lab** scenario that comes with Quest Lab has five experiments to try and to copy from: a bounce test, sink or float, bridge builders, pendulums and a balance beam.

## Switching it on

Open the scene and choose **⚙️ Scene settings**. Under **Physics experiment**, press **🧲 Make this a physics experiment**. The scene's avatars are hidden at the same time: an experiment is worked with the pointer, and an avatar walking about only gets in the way. Tick **Show avatars** again if you want them.

Physics can also be switched on by adding anything physical from **+ Add to scene…**.

The experiment's settings are under **🧲 Physics experiment** at the top of the outline's physics lists:

| Setting | What it does |
| ------- | ------------ |
| **Physics switched on** | Untick to keep the experiment but play the scene without it |
| **Who shares the experiment** | **Each player has their own**: it runs in each player's browser. **Everyone in the scene shares one**: the game server runs it, and everyone of the same team in the scene sees and changes the same experiment, such as a bridge a team builds together |
| **Gravity** | 9.81 m/s² is Earth's. The Moon's is 1.62, Mars's 3.71, Jupiter's 24.79 |
| **Scene pixels in a metre** | How big the world is. 100 makes a 1920-pixel scene 19 m wide, right for a bridge over a canyon. 2000 makes it about a metre wide, right for a glass of water on a table. Things fall and swing as they would at that size |
| **How thick everything is** | The scene is flat, so masses and volumes need a thickness from front to back. 0.1 m unless you change it |
| **Floor** | Along the bottom of the scene, at a height you choose (a table top), or none (things fall away, as into a canyon) |
| **Walls** | Up the scene's left and right edges, so nothing rolls off the side |
| **Start paused** | Nothing moves until a player presses Play: four pendulums let go at once |
| **Buttons** | Play and pause, Reset, Slow motion, a **gravity chooser** (Earth, Moon, Mars, Jupiter, none), and **Drop**, which lets go of everything held in place |
| **Press tool** | A second tool beside moving things: hold on something to push down on it, harder the longer it is held, up to a limit |

**Test this scene** always runs the experiment on your own, even a shared one.

## What can be in an experiment

Everything is placed on the canvas, drawn as it will start, and dragged to move. The outline lists it under **Physics bodies**, **Water**, **Joints** and **Bridge building**.

### Bodies

A body is anything solid: a ball, a block, a rock, a plank, a glass. Choose its **shape** (circle, box, polygon or cup) and size, and its **material**. The material decides how heavy it is for its size, how bouncy and how slippery:

| Material | Bounciness | Notes |
| -------- | ---------- | ----- |
| Rubber | 0.85 | A bouncy ball |
| Plastic, glass, steel | 0.6 to 0.65 | Steel is eight times as heavy as water |
| Wood | 0.45 | Floats |
| Rock | 0.2 | Sinks |
| Clay | 0.05 | Barely bounces at all |
| Foam, cork | 0.3, 0.4 | Very light: float high |
| Ice | 0.2 | Slippery; floats low |
| Lead | 0.1 | Very heavy |
| Rope | 0 | For bridges: only pulls |

The boxes for **bounciness**, **friction** and **density** show the material's values; type your own to override them. **Mass** sets what the body weighs whatever its size: a 2 kg weight.

| Option | What it does |
| ------ | ------------ |
| **Fixed in place** | Never moves: a floor, a shelf, a cliff, a glass on a table |
| **Held in place until Drop** | Waits where it is. Players can still drag it to set it up (a ball at a chosen height), then press **Drop** |
| **Players can pick it up** | On for anything that moves, unless you untick it |
| **Slows down by itself** | Air resistance, or a stiff hinge. About 2 makes a balance beam settle in a few swings |
| **Not drawn** | The background already shows it: a cliff or a table painted into the picture. It is still solid |
| **Ruler along it** | A tick every 10 cm from its middle, numbered every half metre: for a balance beam |
| **Picture over it**, **Text on it**, **Colour** | How it looks |

A **cup** is open at the top: a glass, a beaker, a tank. Pour water into it (below).

### Water

**+ Add to scene… › Physics: a glass of water** adds a glass and the water in it. Water can also fill a **tank** of its own, a box over something drawn in the background.

Whatever goes into water pushes it up by its own volume. Things lighter than water float, lower or higher depending on how light they are; heavier things sink. Water that rises over the rim spills, and is gone. Tick **Scale up the side** for a millilitre scale.

### Joints

A joint holds a body to another body, or to a fixed point in the world:

| Kind | Use it for |
| ---- | ---------- |
| **Pin** | A hinge or a pivot: the body turns about the point. Limit how far it turns for a seesaw |
| **Weld** | Two bodies stuck together into one shape |
| **String** | Always the same length: a pendulum |
| **Spring** | Stretches and bounces back |
| **Rope** | Up to its length, and slack when pushed |

Give a joint a **strength** in newtons and it breaks when it is pulled harder than that.

### A bridge to build

**+ Add to scene… › Physics: an area to build a bridge in** adds the area in which players build. While they build nothing moves: they drag from a **footing** (the yellow points, fixed to the world: the edges of a canyon) to lay a beam, and from the end of that beam to lay the next. Beam ends snap to a grid. **Test it** puts the design to the test; **Back to building** returns to it, keeping every beam.

In the building area's panel set the **footings** (drag them on the canvas), the **longest beam**, the **budget**, and the **kinds of beam** players may use, each with a cost a metre. Mark the road as **Road**: weights rest on it, while other beams only hold the structure up. Each beam's ends break at the beam's strength. A flat road on its own sags like a hanging chain and breaks easily; triangles of beams share the load and hold far more.

## Readouts

**Readouts**, in the experiment's settings, are the numbers shown in the corner while it runs:

| Measure | Of |
| ------- | -- |
| Height, Highest point, Speed, Mass | A body |
| **Bounce height** | How high a body rose after it first hit the floor. Picking it up and letting go measures afresh |
| **Tilt** | How far a body has turned from where it started: a balance beam |
| **Swing time**, **Swings** | A full swing there and back of a pendulum, and how many it has made |
| **Water level**, **Water rise**, **Water pushed aside**, **Spilled** | Water |
| **Pushing with**, **Broke at** | The press tool |
| **Load carried**, **Most it held**, **Cost** | A bridge: what it holds up beyond its own weight, the most it held before anything broke, and the design's cost |
| **Most strained**, **Broken joints**, **Time** | Anything |

Give a readout a **variable** and the variable follows it, rounded as shown. Then an objective can say *Make the water rise 1 cm*, a text can say *You bounced it {{rubber_bounce}} m*, and teachers see the value in reports.

## The tray

The **tray** holds things players take out and put into the experiment: weights, balls, rocks, corks. Each has a button on screen; a player taps it, then taps where it should go, and can drag it from there. Limit how many can be taken, or leave it unlimited. Reset fills the tray again.

## Watches

A **watch** notices something while the experiment runs, and then sets a variable and runs one of the scene's **indirect events**:

| When | Notices |
| ---- | ------- |
| **Something breaks** | A joint or a beam breaking (one of them, or any) |
| **Something goes into a place or the water** | A body entering a box you mark, or the water |
| **A reading passes a value** | A readout reaching, passing or falling below a number |
| **Everything stops moving** | Every body at rest for so many seconds |
| **A body stays level** | A body within so many degrees of level for so many seconds: a balanced beam |
| **Water spills over** | A container overflowing |

*Stops moving* and *stays level* only count once a player has done something, so they do not happen as the scene opens. A watch happens once; after a reset it can happen again.

## Physics actions

The **Physics** action lets any event drive the experiment: play, pause, reset, drop what is held, add something from the tray at a spot, remove a body, change gravity, slow motion, test a bridge or go back to building. A hotspot labelled *Try it on the Moon* with a physics action setting gravity to 1.62 is all it takes.

In a shared experiment the action changes it for everyone in the scene.
