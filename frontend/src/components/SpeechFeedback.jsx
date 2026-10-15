import { useState } from 'react';
import { callApi } from '../api.js';

const MAX_CHARS = 5000; // matches MAX_SPEECH_CHARS in backend/app.js

// Added for N3.3: send a speech to POST /api/feedback with fetch and render the
// structured JSON that comes back, without reloading the page.
function SpeechFeedback() {
  const [speech, setSpeech] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault(); // keep the browser from doing a traditional form submit
    const text = speech.trim();
    if (!text) {
      setError('Paste or type your speech first.');
      return;
    }

    setIsLoading(true);
    setError('');
    setFeedback(null);
    try {
      setFeedback(await callApi('/api/feedback', { body: { speech: text } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="feature" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">Get feedback on a speech</h2>
      <p className="feature__hint">
        Paste a short speech or opening. The backend asks Gemini for a clarity score, strengths, and improvements.
      </p>
      <form className="feedback-form" onSubmit={handleSubmit}>
        <label htmlFor="speech-text" className="visually-hidden">Speech text</label>
        <textarea
          id="speech-text"
          className="speech-input"
          rows={7}
          maxLength={MAX_CHARS}
          value={speech}
          onChange={(event) => setSpeech(event.target.value)}
          placeholder="Good morning, everyone. Today I want to talk about…"
          disabled={isLoading}
        />
        <div className="feedback-form__row">
          <span className="char-count">{speech.length} / {MAX_CHARS}</span>
          <button type="submit" className="primary-button" disabled={isLoading}>
            {isLoading ? 'Reviewing…' : 'Get feedback'}
          </button>
        </div>
      </form>

      <div className="answer-box feedback-result" aria-live="polite">
        {error && <p className="error-text">{error}</p>}
        {!error && !feedback && !isLoading && <p className="muted">Your feedback will appear here.</p>}
        {isLoading && <p className="muted">Reviewing your speech…</p>}
        {feedback && (
          <>
            <p className="score">
              Clarity <strong>{feedback.clarityScore}</strong>/10
            </p>
            <p>{feedback.summary}</p>
            <h3>Strengths</h3>
            <ul>{feedback.strengths.map((item, i) => <li key={i}>{item}</li>)}</ul>
            <h3>Try next</h3>
            <ul>{feedback.improvements.map((item, i) => <li key={i}>{item}</li>)}</ul>
          </>
        )}
      </div>
    </section>
  );
}

export default SpeechFeedback;
