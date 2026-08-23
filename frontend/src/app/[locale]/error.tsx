'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  const ui = useTranslations('UI');

  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div>
      <h2>{ui('something_went_wrong')}</h2>
      <button
        onClick={
          // Attempt to recover by trying to re-render the segment
          () => reset()
        }
      >
        {ui('try_again')}
      </button>
    </div>
  );
}
