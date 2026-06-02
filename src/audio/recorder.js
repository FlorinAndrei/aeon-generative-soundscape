// Wrap MediaRecorder around the graph's recording tap so a session can be
// captured to a downloadable file. Picks whatever audio container the browser
// supports (webm/opus on Chromium, mp4/aac on Safari).

export function createRecorder(stream) {
  let rec = null;
  let chunks = [];

  function pickType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }

  return {
    start() {
      if (rec) return;
      chunks = [];
      const mimeType = pickType();
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.start();
    },
    stop() {
      return new Promise((resolve) => {
        if (!rec) return resolve();
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          const ext = (rec.mimeType || 'webm').includes('mp4') ? 'mp4' : 'webm';
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `aeon-${Date.now()}.${ext}`;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          rec = null;
          resolve();
        };
        rec.stop();
      });
    },
  };
}
