'use client';

import SwipeGame from '../SwipeGame';
import { COMPANIES } from './companies';

const HOW_TO_PLAY = [
  'Split into two teams.',
  'One player from the guessing team turns away from the screen. Everyone else can see it.',
  'Start the turn. A company name appears: your team gives clues, the other team tries to throw the guesser off.',
  'Swipe right (or tap Guessed) when they get it. Swipe left to skip.',
  'When the buzzer goes, hand over to the other team. Most points wins.',
];

const RULES = [
  'You can talk and give the clues.',
  'No direct use of founder names as clues.',
  'You can use the company’s use case as a clue.',
  'There’s no limit on the number of clues.',
];

export default function GuessTheCompany() {
  return (
    <SwipeGame
      title="Guess The Company"
      intro={
        <>
          Dumb charades for founders. One player from the guessing team faces away from the screen. Their team gives
          clues, the other team tries to throw them off. Swipe <b className="text-white">right</b> when they get it,{' '}
          <b className="text-white">left</b> to skip.
        </>
      }
      howToPlay={HOW_TO_PLAY}
      rules={RULES}
      items={COMPANIES}
      label={(c) => c}
      renderCard={(c) => <h2 className="text-4xl md:text-6xl font-black tracking-tight break-words">{c}</h2>}
    />
  );
}
