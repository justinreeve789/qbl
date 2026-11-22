---
title: Close-up experiments (the bench)
description: Turn a scene into a lab bench where students pour, mix, heat, stir and measure, and say what happens when things meet.
---

A **close-up bench** is a scene worked with the hands instead of the feet. Students see containers standing on your background: beakers, test tubes, flasks, stock bottles, droppers. They tap one to pick it up and tap another to tip it in. They light a burner, stir, and watch what happens: a fizz, a change of colour, a layer settling, a graph climbing.

What happens is what you wrote. A bench is a model of a lab for learning, not chemistry worked out from first principles: only the reactions you list take place, so it is safe to hand to a class and quick to build.

The **Science Lab** demo (`/sciencelab`, put there by `qbl:seed`) has four benches to copy from: fizz, a titration, liquids in layers, and dissolving and boiling dry.

## Make a scene a bench

In the scene editor, select **Scene settings** and press **🧪 Make this a close-up bench**. The scene gets a bench with water in it, and its avatars are hidden, so the whole scene is the bench and is always shown whole. (Show the avatars again in the scene's settings if you want a bench inside a walk-around room.)

Then use **+ Add to scene…**:

| Add | What it is |
| --- | ---------- |
| **Bench: a beaker to mix in** | A container that things are poured into. Change its kind to a test tube, conical flask, measuring cylinder, dish, jar or dropper |
| **Bench: a stock bottle to pour from** | It never runs out, and nothing can be poured into it. Say what is in it |
| **Bench: a dropper** | A stock bottle that gives a drop at a time, for the last careful step |
| **Bench: a burner** | Heats the container that stands on it. Students tap it to light it and put it out |
| **Bench: a stirring rod** | Picked up, then tapped on a container to stir it |
| **Bench: a sink** | Where a container in the hand is emptied |

Drag containers and tools on the canvas to place them. Each stands on the point you drag: the middle of its foot.

## What is on the bench

Select **🧪 Close-up bench** in the outline for everything that is not a place on the scene.

### Substances

Everything that can be in a container. Each has a **name** students read and a **short name** (`baking_soda`) that recipes and reactions use.

- **Liquid, solid or gas.** Liquids are measured in mL. A solid is measured in grams and lies at the bottom. A gas leaves the container and is counted as given off.
- **Colour**, and **how strongly it colours a mixture**: 0.2 for water, which takes the colour of what is put in it; 10 for a dye.
- **pH**, for an acid or a base. A mixture's pH is worked out from what is in it: acids and bases cancel, and everything else dilutes them, so a titration has its real curve.
- **An indicator**: its colour at each pH, written `1:#e53935, 7:#43a047, 13:#8e24aa`. A little of it colours the whole mixture, and the colour follows the pH.
- **Density**, and **it does not mix**: such a liquid lies in a layer of its own, above or below the others by density. Oil on water on honey.
- **Boils at**: a container holding it gets no hotter.

**+ Add a ready-made set…** puts in substances and reactions that go together, to change as you like: kitchen fizz, acids and bases with an indicator, liquids that float on each other, dissolving and boiling dry.

### Reactions

What happens when the right things are in a container together. Two substances with no reaction simply mix.

Write **what turns into what** as an equation of short names:

```
2 vinegar + 1 baking_soda -> 2 salty_water + 6 co2
```

On the left, what has to be there and how much one round uses up. On the right, what a round makes. An amount of `0` on the left means it has to be there but is not used up (a catalyst, or water that something dissolves in). The right may be empty.

- **Only when**: conditions that also have to hold, separated by `;`. `temperature >= 60; stirred = 1`. The names are `temperature` (°C), `volume` (mL), `ph`, `stirred` (1 for a few seconds after stirring), `time` (seconds) and any substance's short name (how much of it is there): `water < 1`.
- **Rounds a second**: left empty, it happens all at once.
- **Heat**: how many degrees a round warms 100 mL. Negative for a reaction that gets colder.
- **What it looks like**: bubbles, fizzing over, smoke or steam, a glow, a flash.
- **Tell the player, the first time**: a line such as "It fizzes!".

### Readouts

Numbers shown beside the bench: the volume in a container, its temperature, its pH, how much of a substance it holds, how much gas it has given off, how many times something was poured in, the time. A readout can also be **worked out from other readings** with a formula of their short names: `salt / volume * 100`.

Give a readout a **variable** to keep its value: for an objective ("so far: {{fizz_gas}} mL"), a condition, or the class report.

### Watches

A watch notices something and then **sets a variable** and **runs an indirect event** of the scene: a reaction happening, a reading passing a value, a container holding something, a container running over. That is how a bench ticks off an objective, says something, gives an award or opens an infobox. A watch notices once unless you tick **Every time it happens**.

### Graph

A graph beside the bench plots one readout against another, or against time. By default students press **Record** to put a point on it, so they decide what to measure and when; it can also add a point twice a second by itself. Give it a **variable** and the points are kept: a **Graph** block in an [infobox](/docs/editor/infoboxes/#maths-science-and-graphs) can show them later, and they are still there on the next visit.

## Working the bench from events

The **Bench** action lets an event put the bench back as it started, add something to a container, empty or stir one, or light a burner. Use it for a "Try again" button, or to have a character add the mystery sample.

## What it does not do yet

- Each student has their own bench. What comes of it reaches the team through variables shared by everyone and through events, as anything a student does on their own does.
- What is on the bench is not kept between visits. Readouts, watches and the graph keep their variables.
- There is one burner heat and one stir. Containers do not break, and nothing is weighed on a balance.
