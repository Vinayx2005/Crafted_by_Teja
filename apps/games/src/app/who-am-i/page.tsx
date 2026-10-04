'use client';

import SwipeGame from '../SwipeGame';
import { FOUNDERS } from './founders';

const HOW_TO_PLAY = [
  'Split into two teams.',
  'One player from the guessing team turns away from the screen. They are now the founder on the card.',
  'Start the turn. A founder’s photo appears: your team describes them, the other team tries to throw the guesser off.',
  'The guesser asks “Who am I?” and guesses. Swipe right (or tap Guessed) when they get it, left to skip.',
  'When the buzzer goes, hand over to the other team. Most points wins.',
];

const RULES = [
  'Describe their personality, habits, looks, famous moments or quotes.',
  'Don’t say the founder’s name or their company’s name.',
  'You can act out their mannerisms.',
  'There’s no limit on the number of clues.',
];

export default function WhoAmI() {
  return (
    <SwipeGame
      title="Who Am I?"
      intro={
        <>
          You <i>are</i> the founder on screen, you just don&apos;t know who. Your team describes your character and
          behaviour while the other team heckles. Swipe <b className="text-white">right</b> when you get it,{' '}
          <b className="text-white">left</b> to skip.
        </>
      }
      howToPlay={HOW_TO_PLAY}
      rules={RULES}
      items={FOUNDERS}
      label={(f) => f.name}
      renderCard={(f) => (
        <div className="flex flex-col items-center">
          <img
            src={f.img}
            alt={f.name}
            draggable={false} // native image drag would hijack the swipe
            className="h-56 w-56 md:h-64 md:w-64 rounded-2xl object-cover object-top bg-18-bg"
          />
          <h2 className="text-3xl md:text-4xl font-black tracking-tight mt-4">{f.name}</h2>
          <p className="text-sm md:text-base text-18-orange font-semibold mt-1">{f.company}</p>
          <a
            href={`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f.file)}`}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(e) => e.stopPropagation()} // tapping the credit shouldn't start a swipe
            className="text-[10px] text-white/30 hover:text-white/60 mt-1"
          >
            Photo: Wikimedia Commons
          </a>
        </div>
      )}
    />
  );
}
