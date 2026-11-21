<?php

namespace App\Qbl\Generation\Design;

use Random\Randomizer;

/**
 * Twists and turns from other missions, for the mission designer to take inspiration from: a few are
 * picked at random for each mission, so missions do not all reach for the same surprise, and the
 * designer is asked to invent one of its own besides (see MissionDesigner).
 *
 * A twist makes things harder; a turn is a change of luck or of heart that helps. "Big" ones put a
 * character in trouble (someone falls, is trapped or swept away) and are kept for few missions: whether
 * a mission may have one is decided by chance (`pacing.big_moment_chance`), not left to the model.
 */
final class TwistIdeas
{
    /** @var list<array{key: string, name: string, what: string, teaches: string, big: bool}> */
    public const IDEAS = [
        ['key' => 'swapped_labels', 'name' => 'Swapped labels', 'big' => false,
            'what' => 'Two jars, samples or wires turn out to have their labels swapped; what students relied on is wrong.',
            'teaches' => 'Trust evidence over labels: test a property (taste is never one) to tell them apart.'],
        ['key' => 'confident_mistake', 'name' => 'A confident mistake', 'big' => false,
            'what' => 'A trusted character states something wrong with great confidence, and the plan goes astray because of it.',
            'teaches' => 'Check claims against evidence; a misconception from the lesson, voiced by someone students like.'],
        ['key' => 'power_cut', 'name' => 'Power cut', 'big' => false,
            'what' => 'The lights and machines go dark part-way through; work must go on by torchlight until the power is back.',
            'teaches' => 'Circuits and energy: find the break, the flat battery, the blown fuse.'],
        ['key' => 'tide', 'name' => 'The tide turns', 'big' => false,
            'what' => 'The water comes in and cuts off a path, or goes out and uncovers one that was not there before.',
            'teaches' => 'Tides and the moon, timing, cycles in nature.'],
        ['key' => 'collector_animal', 'name' => 'A collector animal', 'big' => false,
            'what' => 'A magpie, monkey or crab snatches a tool and carries it off to its nest, where it keeps shiny things.',
            'teaches' => 'Animal behaviour: learn what it wants and trade for the tool.'],
        ['key' => 'fog', 'name' => 'Fog rolls in', 'big' => false,
            'what' => 'Thick fog hides the landmarks; the way on must be found another way.',
            'teaches' => 'Navigation: a compass, the sun, sounds, counting steps, a map\'s scale.'],
        ['key' => 'map_misread', 'name' => 'The map was misread', 'big' => false,
            'what' => 'The map was upside down, or its scale misread: the place they reached is not where they meant to be.',
            'teaches' => 'Maps, directions, scale and measuring.'],
        ['key' => 'overgrowth', 'name' => 'Too much of a good thing', 'big' => false,
            'what' => 'A plant fed too much (or a culture given too much warmth) grows wildly and blocks the door.',
            'teaches' => 'What living things need, and that more is not always better.'],
        ['key' => 'freeze', 'name' => 'Frozen solid', 'big' => false,
            'what' => 'The temperature drops and a lock, a pump or a pipe freezes up.',
            'teaches' => 'States of matter: what melts ice, why salt helps, insulation.'],
        ['key' => 'coded_note', 'name' => 'A note in code', 'big' => false,
            'what' => 'An important message turns up written in a pattern, a cipher or an old script.',
            'teaches' => 'Patterns, sequences, how people wrote in the past.'],
        ['key' => 'hollow_echo', 'name' => 'A hollow echo', 'big' => false,
            'what' => 'A knock on a wall or the floor sounds hollow: there is a hidden room or tunnel behind it. (A turn.)',
            'teaches' => 'Sound and vibration: how it travels through solids and spaces.'],
        ['key' => 'unexpected_ally', 'name' => 'An unexpected ally', 'big' => false,
            'what' => 'A grumpy character, or a rival, turns out to help once students understand what was troubling them. (A turn.)',
            'teaches' => 'Seeing another point of view; the history or the science behind their worry.'],
        ['key' => 'too_well', 'name' => 'It worked too well', 'big' => false,
            'what' => 'The fix overshoots: foam everywhere, the balloon floats off, the pump floods the room.',
            'teaches' => 'Proportions, measuring, changing one thing at a time.'],
        ['key' => 'eclipse', 'name' => 'Darkness at noon', 'big' => false,
            'what' => 'An eclipse darkens the sky by day; night creatures wake and the plan has to change.',
            'teaches' => 'The sun, the moon and shadows; animals that follow light.'],
        ['key' => 'wrong_era', 'name' => 'Out of its time', 'big' => false,
            'what' => 'Something turns up that cannot belong in this time or place, and it is a clue to who was here.',
            'teaches' => 'Chronology and evidence: telling when things were made and used.'],
        ['key' => 'weak_bridge', 'name' => 'The bridge creaks', 'big' => false,
            'what' => 'A bridge, a raft or a lift can only carry so much: the load has to be lightened or spread out.',
            'teaches' => 'Forces and weight, balance, fair sharing of a load.'],
        ['key' => 'lost_young', 'name' => 'A lost little one', 'big' => false,
            'what' => 'A young animal has lost its parent and follows the crew around until it is brought home.',
            'teaches' => 'Life cycles and habitats: matching calls, tracks or food to the right parent.'],
        ['key' => 'spoiled_supply', 'name' => 'Something in the water', 'big' => false,
            'what' => 'The water or the food store has gone bad, and everyone needs it.',
            'teaches' => 'Cause and effect: trace it to its source; food chains, hygiene, filtering.'],
        ['key' => 'on_a_schedule', 'name' => 'Like clockwork', 'big' => false,
            'what' => 'A geyser, a gust or a machine goes off in a pattern; the crossing must be timed between bursts.',
            'teaches' => 'Patterns, measuring time, predicting from data.'],
        ['key' => 'rival_claim', 'name' => 'Someone got there first', 'big' => false,
            'what' => 'Another crew claims the discovery; the students must show it is theirs with what they recorded.',
            'teaches' => 'Claims and evidence; why scientists keep careful notes.'],
        ['key' => 'gravity', 'name' => 'Lighter than expected', 'big' => false,
            'what' => 'On a small moon things float, bounce and fall slowly; the usual way of doing things fails.',
            'teaches' => 'Gravity, mass and weight.'],
        ['key' => 'lost_voice', 'name' => 'The guide loses their voice', 'big' => false,
            'what' => 'The guide cannot speak, and the students must explain what they found to someone else in their place.',
            'teaches' => 'Explaining shows understanding: students become the teachers.'],
        ['key' => 'lucky_gust', 'name' => 'A lucky gust', 'big' => false,
            'what' => 'Wind, a wave or a passing animal knocks down or uncovers exactly what was needed. (A turn.)',
            'teaches' => 'Wind, water and animals move things: seeds, sand, pollen.'],
        ['key' => 'jammed_lift', 'name' => 'Stuck in the lift', 'big' => true,
            'what' => 'A character is trapped in a jammed lift, cage or behind a stuck door, and students free them.',
            'teaches' => 'Simple machines: a lever, a pulley, a wedge, a counterweight.'],
        ['key' => 'swept_away', 'name' => 'Swept downstream', 'big' => true,
            'what' => 'A character\'s raft drifts off on the current; students reach them with what the river gives.',
            'teaches' => 'Flow, floating and sinking, forces in water.'],
        ['key' => 'over_the_edge', 'name' => 'Over the edge', 'big' => true,
            'what' => 'A character slips off a ledge and clings on below; students build something to lift them up.',
            'teaches' => 'Pulleys and ropes, materials and their strength.'],
    ];

    /**
     * A handful of ideas for one mission, at random: big ones only when the mission may have a big
     * moment, and then at least one.
     *
     * @return list<array{key: string, name: string, what: string, teaches: string, big: bool}>
     */
    public static function pick(Randomizer $random, int $count, bool $big): array
    {
        $small = array_values(array_filter(self::IDEAS, fn ($i) => ! $i['big']));
        $large = array_values(array_filter(self::IDEAS, fn ($i) => $i['big']));
        $out = array_slice($random->shuffleArray($small), 0, $big ? $count - 1 : $count);
        if ($big) {
            $out[] = $random->shuffleArray($large)[0];
        }

        return $out;
    }

    /** Whether a twist's title or key is one of the ideas, as it is: not one the designer invented. */
    public static function isIdea(array $twist): bool
    {
        $norm = fn (string $s) => preg_replace('/[^a-z]+/', '', strtolower($s));
        foreach (self::IDEAS as $idea) {
            if ($norm($twist['key'] ?? '') === $norm($idea['key']) || $norm($twist['title'] ?? '') === $norm($idea['name'])) {
                return true;
            }
        }

        return false;
    }
}
