import assert from "node:assert/strict";
import { tapAndroidControl } from "./android-ui-smoke";

type Evaluate = <T>(expression: string) => Promise<T>;
type Command = (...args: string[]) => Promise<string>;

/** Exercises both WebView consent and Android's RECORD_AUDIO runtime dialog. */
export async function checkAndroidMicrophone(evaluate: Evaluate, command: Command, virtualTone = false) {
  const tap = (pattern: RegExp) => tapAndroidControl(command, pattern);
  const begin = () => evaluate(`(() => {
    window.__microphoneSmoke = {status:'pending'};
    navigator.mediaDevices.getUserMedia({audio:true}).then(async stream => {
      const live=stream.getAudioTracks().every(track=>track.readyState==='live');
      // Headless emulators can expose a live input without audio frames when
      // host microphone input is disabled. Mix a virtual tone for codec checks.
      const audio=${virtualTone} ? new AudioContext() : null;
      const destination=audio?.createMediaStreamDestination();
      const tone=audio?.createOscillator();
      if(audio) {
        audio.createMediaStreamSource(stream).connect(destination);
        const gain=audio.createGain();gain.gain.value=0.005;
        tone.connect(gain).connect(destination);tone.start();await audio.resume();
      }
      const chunks=[];
      const recorder=new MediaRecorder(destination?.stream || stream);
      const stopped=new Promise(resolve=>recorder.onstop=resolve);
      recorder.ondataavailable=event=>{if(event.data.size) chunks.push(event.data)};
      recorder.start();
      await new Promise(resolve=>setTimeout(resolve,750));
      recorder.stop(); await stopped;
      stream.getTracks().forEach(track=>track.stop());
      tone?.stop();destination?.stream.getTracks().forEach(track=>track.stop());await audio?.close();
      window.__microphoneSmoke={status:'recorded',tracks:stream.getAudioTracks().length,live,bytes:new Blob(chunks).size,mime:recorder.mimeType,virtualTone:${virtualTone}};
    }).catch(error=>window.__microphoneSmoke={status:'denied',error:error.name});
    return true;
  })()`);
  const result = async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const state = await evaluate<{status: string; tracks?: number; live?: boolean; bytes?: number; mime?: string; error?: string}>("window.__microphoneSmoke");
      if (state.status !== "pending") return state;
      await Bun.sleep(100);
    }
    throw new Error("Microphone request did not settle");
  };
  await begin();
  await tap(/text="Cancel"/i);
  assert.deepEqual(await result(), { status: "denied", error: "NotAllowedError" });
  await begin();
  await tap(/text="Allow"/i);
  await tap(/resource-id="[^"]*permission_allow_foreground_only_button"/);
  const captured = await result();
  assert.equal(captured.status, "recorded", captured.error || "Microphone recording did not finish");
  assert.equal(captured.tracks, 1);
  assert.equal(captured.live, true);
  assert.ok(captured.bytes! > 0, "MediaRecorder must produce audio bytes");
  return { deniedThenAllowed: true, ...captured };
}
