import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { createOperationFeedback } from './feedbackState';
import { errorMessage, t } from './i18n';

const FeedbackContext = createContext<ReturnType<typeof createOperationFeedback> | null>(null);

export function OperationFeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback] = useState(createOperationFeedback);
  useEffect(() => () => feedback.dispose(), [feedback]);
  return <FeedbackContext.Provider value={feedback}>{children}</FeedbackContext.Provider>;
}

export function useOperationFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('Missing OperationFeedbackProvider');
  return {
    ...feedback,
    async run<T>(operation: () => Promise<T>, success: string | null | ((result: T) => string | null), failure?: string) {
      const id = feedback.begin(t('operationPending'));
      try {
        const result = await operation();
        feedback.success(id, typeof success === 'function' ? success(result) : success);
        return { ok: true as const, value: result };
      } catch (reason) {
        feedback.error(id, failure || errorMessage(reason));
        return { ok: false as const };
      }
    },
  };
}

const subscribeEmpty = () => () => {};
const emptySnapshot = () => null;

export function useOperationFeedbackActive() {
  const feedback = useContext(FeedbackContext);
  return !!useSyncExternalStore(feedback?.subscribe ?? subscribeEmpty, feedback?.getSnapshot ?? emptySnapshot);
}

function FeedbackStatus({ feedback }: { feedback: ReturnType<typeof createOperationFeedback> }) {
  const status = useSyncExternalStore(feedback.subscribe, feedback.getSnapshot);
  return <span className="operation-feedback" aria-live={status?.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true" role={status ? status.kind === 'error' ? 'alert' : 'status' : undefined}>
    {status ? <><span className="operation-feedback-message" title={status.message}>{status.message}</span>
      {status.kind === 'error' ? <button className="operation-feedback-dismiss" aria-label={t('dismissFeedback')} title={t('dismissFeedback')} onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) event.preventDefault();
      }} onClick={feedback.dismiss}><X size={12} /></button> : null}</> : null}
  </span>;
}

export function OperationFeedbackStatus() {
  const feedback = useContext(FeedbackContext);
  return feedback ? <FeedbackStatus feedback={feedback} /> : null;
}
