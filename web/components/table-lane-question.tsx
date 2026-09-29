'use client';

// Breadth step 5 (Task 6): the buttons under a table-lane breakdown question.
// The server already capped the options (first 12 members, CBS order) and told
// us how many the dimension really has; a click sends the member CODE, never a
// guess. A reader whose choice is not among the buttons types the name in the
// composer - the server matches it against the dimension's FULL member list.
import type { BreakdownQuestion } from '../backend/query/breakdowns.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { PILL } from './chip-style.ts';


/** Hard ceiling on shown buttons (mirrors BREAKDOWN_OPTION_CAP server-side); a
 * belt so a malformed envelope can never render a wall of buttons. */
export const TABLE_LANE_MAX_BUTTONS = 12;

export function TableLaneQuestion({
  question,
  disabled = false,
  onChoose,
}: {
  question: BreakdownQuestion;
  disabled?: boolean;
  /** `title` is the member's CBS title - what the reader clicked. */
  onChoose: (choice: { code: string }, title: string) => void;
}) {
  const t = useT();
  const options = question.options.slice(0, TABLE_LANE_MAX_BUTTONS);
  return (
    <div className="mt-2" data-testid="table-lane-question">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.code}
            type="button"
            disabled={disabled}
            onClick={() => onChoose({ code: option.code }, option.title)}
            className={PILL + ' disabled:opacity-50'}
          >
            {option.title}
          </button>
        ))}
      </div>
      {question.totalOptions > options.length ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('tableLane.moreOptionsHint')}</p>
      ) : null}
    </div>
  );
}
