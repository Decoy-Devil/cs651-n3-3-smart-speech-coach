import { useState } from 'react';
import speechCoachLogo from './assets/speech-coach-logo.jpg';
import './App.css';
import NavigationBar from './components/NavigationBar';
import BackendStatus from './components/BackendStatus';
import SpeechFeedback from './components/SpeechFeedback';
import { callApi } from './api.js';

function App() {
  // message: what the user is typing. answer: what shows in the answer box.
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Runs when the user presses Enter or clicks Ask.
  async function handleSubmit(event) {
    // Stop the browser from doing a traditional form submit (full page reload).
    event.preventDefault();

    const question = message.trim();
    if (!question) {
      setAnswer('Please type a question first.');
      return;
    }

    setIsLoading(true);
    setAnswer('Thinking...');
    try {
      // fetch → POST /api/askanything on the backend. The backend holds the Gemini key
      // and calls Gemini for us, so the key never reaches the browser.
      const data = await callApi('/api/askanything', { body: { message: question } });
      setAnswer(data.answer);
    } catch (error) {
      setAnswer(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <NavigationBar />
      <BackendStatus />

      <section id="center">
        <div className="hero">
          <img
            src={speechCoachLogo}
            className="hero-image"
            alt="AI coach helping a speaker at a podium"
          />
        </div>
        <h1>Ask me anything</h1>
        <form className="question-form" onSubmit={handleSubmit}>
          <input
            className="question-input"
            type="text"
            maxLength={500}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type your question and press Enter"
            aria-label="Type your question"
            disabled={isLoading}
          />
        </form>
        <div className="answer-box" aria-live="polite">
          {answer}
        </div>
      </section>

      <div className="ticks"></div>
      <SpeechFeedback />

      <div className="ticks"></div>
      <section className="how-it-works" aria-labelledby="how-heading">
        <h2 id="how-heading">How this page works</h2>
        <ol>
          <li>This React page runs in your browser (Vite dev server or Firebase Hosting).</li>
          <li>JavaScript calls the backend with <code>fetch()</code> and sends JSON.</li>
          <li>The Node/Express backend on Google Cloud Run adds the private Gemini API key and calls Gemini.</li>
          <li>The backend returns JSON, and React updates part of the page without reloading.</li>
        </ol>
      </section>

      <div className="ticks"></div>
      <section id="spacer"></section>
    </>
  );
}

export default App;
