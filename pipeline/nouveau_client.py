"""Client for the local `nouveau` API (default http://127.0.0.1:8005) — standard library only.

Everything the voice and the source import need: the YouTube metadata, the English transcript,
the French narration translation, Fish Audio TTS, and the Deepgram timings of the audio it produced.
Calls are kept on real video ids so the episode stays visible in the nouveau UI.

    from nouveau_client import Nouveau
    nv = Nouveau()
    nv.video('6iiUZwkPnu8')
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple

DEFAULT_URL = "http://127.0.0.1:8005"
# ElevenLabs TTS (default on :8005): v4 model + French voices Hugo (male) and Léa (female).
ELEVENLABS_MODEL = "eleven_v4"
ELEVENLABS_MODELS = ("eleven_v4", "eleven_v3", "eleven_multilingual_v2")
ELEVENLABS_VOICE = "3Tp5mYhT9wrfnry9pzvV"  # "Hugo" (fr-FR, male, default)
ELEVENLABS_VOICE_LEA = "KSyQzmsYhFbuOhqj1Xxv"  # "Léa" (fr-FR, female)
ELEVENLABS_VOICES: Dict[str, str] = {
    "3Tp5mYhT9wrfnry9pzvV": "3Tp5mYhT9wrfnry9pzvV",
    "KSyQzmsYhFbuOhqj1Xxv": "KSyQzmsYhFbuOhqj1Xxv",
    "hugo": "3Tp5mYhT9wrfnry9pzvV",
    "male": "3Tp5mYhT9wrfnry9pzvV",
    "lea": "KSyQzmsYhFbuOhqj1Xxv",
    "léa": "KSyQzmsYhFbuOhqj1Xxv",
    "female": "KSyQzmsYhFbuOhqj1Xxv",
}
# Fish Audio "free" tier (optional fallback):
FISH_MODEL = "s2.1-pro-free"
FISH_VOICE = "a688e2ec8bde444a876c160875a61804"  # "Zack D Films" (fr-FR)


class NouveauError(Exception):
    def __init__(self, status: int, detail: str, path: str = "") -> None:
        super().__init__(f"nouveau {path or 'API'} -> HTTP {status}: {detail[:400]}")
        self.status = status
        self.detail = detail
        self.path = path


def base_url() -> str:
    return (os.environ.get("WHATIF_NOUVEAU_URL") or DEFAULT_URL).rstrip("/")


class Nouveau:
    def __init__(self, url: Optional[str] = None, timeout: int = 180) -> None:
        self.base = (url or base_url()).rstrip("/")
        self.timeout = timeout

    # ------------------------------------------------------------------ transport
    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        raw: Optional[bytes] = None,
        content_type: Optional[str] = None,
        timeout: Optional[int] = None,
    ) -> Any:
        url = self.base + path
        headers: Dict[str, str] = {"Accept": "application/json"}
        data = raw
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if content_type:
            headers["Content-Type"] = content_type
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as resp:
                body = resp.read()
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8", errors="ignore")
            except Exception:
                pass
            raise NouveauError(e.code, detail, path) from e
        except Exception as e:  # connection refused, DNS, timeout
            raise NouveauError(0, f"{type(e).__name__}: {e}", path) from e
        if not body:
            return {}
        try:
            return json.loads(body.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return {"raw": body[:2000]}

    def _multipart(self, path: str, fields: Dict[str, str], files: List[Tuple[str, str, bytes]], timeout: int = 300) -> Any:
        border = "-----WhatIfAppUpload"
        parts: List[bytes] = []
        for k, v in fields.items():
            parts.append(f'--{border}\r\ncontent-disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for field, name, content in files:
            parts.append(
                f'--{border}\r\ncontent-disposition: form-data; name="{field}"; filename="{name}"\r\n'
                f"content-type: application/octet-stream\r\n\r\n".encode()
                + content
                + b"\r\n"
            )
        parts.append(f"--{border}--\r\n".encode())
        return self._request(
            "POST", path, raw=b"".join(parts), content_type=f"multipart/form-data; boundary={border}", timeout=timeout
        )

    # ------------------------------------------------------------------ health
    def health(self) -> Any:
        return self._request("GET", "/api/health", timeout=10)

    def fish_status(self) -> Dict[str, Any]:
        return self._request("GET", "/api/fish-audio-tts/status", timeout=20)

    def elevenlabs_status(self) -> Dict[str, Any]:
        return self._request("GET", "/api/elevenlabs-tts/status", timeout=20)

    def inworld_status(self) -> Dict[str, Any]:
        return self._request("GET", "/api/inworld-tts/status", timeout=20)

    def voice_catalog(self) -> Dict[str, Any]:
        return self._request("GET", "/api/voice-catalog", timeout=20)

    # ------------------------------------------------------------------ source video
    def video(self, video_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/api/videos/{video_id}")

    def transcript_check(self, video_id: str, lang: str = "en") -> Dict[str, Any]:
        return self._request("GET", f"/api/videos/{video_id}/transcript/check?lang={lang}")

    def transcribe_video(self, video_id: str, lang: str = "en", diarize: bool = False, poll_sec: int = 900) -> Dict[str, Any]:
        """Deepgram on the source video. Returns the job/state; polls when a job id comes back."""
        path = f"/api/videos/{video_id}/deepgram/diarize?lang={lang}" if diarize else f"/api/videos/{video_id}/deepgram?lang={lang}"
        res = self._request("POST", path, payload={}, timeout=120)
        job = res.get("job_id") or res.get("id") if isinstance(res, dict) else None
        if job:
            res = self.poll_job(str(job), poll_sec=poll_sec)
        return res

    def save_transcript(self, video_id: str, lang: str = "en") -> Dict[str, Any]:
        return self._request("POST", f"/api/videos/{video_id}/deepgram/save?lang={lang}", payload={}, timeout=120)

    def transcript(self, video_id: str, lang: str = "en") -> List[Dict[str, Any]]:
        """The saved transcript, as Deepgram segments ({start, end, text, words[]})."""
        return list(self._request("GET", f"/api/videos/{video_id}/transcript?lang={lang}").get("transcript") or [])

    def transcript_text(self, video_id: str, lang: str = "en") -> str:
        """The saved transcript as plain text, one segment per line."""
        parts = []
        for seg in self.transcript(video_id, lang=lang):
            text = str(seg.get("text") or "").strip()
            if text:
                parts.append(text)
        return "\n".join(parts).strip()

    # ------------------------------------------------------------------ translation
    def translations(self, video_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/api/videos/{video_id}/translations")

    def proposals(self, video_id: str, script_mode: str = "narration", model: Optional[str] = None, timeout: int = 600) -> Dict[str, Any]:
        body: Dict[str, Any] = {"scriptMode": script_mode, "transcriptMode": "reuse"}
        if model:
            body["model"] = model
        return self._request("POST", f"/api/videos/{video_id}/translate/generate", payload=body, timeout=timeout)

    def select_proposal(self, video_id: str, proposal_id: Any) -> Dict[str, Any]:
        return self._request("POST", f"/api/videos/{video_id}/translations/{proposal_id}/select", payload={})

    def edit_proposal(self, video_id: str, proposal_id: Any, **fields: Any) -> Dict[str, Any]:
        return self._request("PATCH", f"/api/videos/{video_id}/translations/{proposal_id}/edit", payload=fields)

    def script_json(self, video_id: str, proposal_id: Any, timeout: int = 600) -> Dict[str, Any]:
        return self._request("POST", f"/api/videos/{video_id}/translations/{proposal_id}/script-json", payload={}, timeout=timeout)

    # ------------------------------------------------------------------ TTS
    def tts_elevenlabs(
        self,
        video_id: str,
        text: str,
        voice_id: str = ELEVENLABS_VOICE,
        model_id: str = ELEVENLABS_MODEL,
        speed: float = 1.0,
        stability: float = 0.5,
        similarity_boost: float = 0.75,
        style: float = 0.0,
        use_speaker_boost: bool = True,
        proposal_id: Optional[Any] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "text": text,
            "voiceId": voice_id,
            "modelId": model_id,
            "stability": float(stability),
            "similarityBoost": float(similarity_boost),
            "style": float(style),
            "useSpeakerBoost": bool(use_speaker_boost),
            "speed": max(0.7, min(1.2, float(speed))),
        }
        if proposal_id:
            body["proposalId"] = proposal_id
        return self._request("POST", f"/api/videos/{video_id}/tts/elevenlabs", payload=body, timeout=600)

    def tts_fish(
        self,
        video_id: str,
        text: str,
        voice_id: str = FISH_VOICE,
        model_id: str = FISH_MODEL,
        speaking_rate: float = 1.0,
        proposal_id: Optional[Any] = None,
    ) -> Dict[str, Any]:
        body = {"text": text, "voiceId": voice_id, "modelId": model_id, "speakingRate": float(speaking_rate)}
        if proposal_id:
            body["proposalId"] = proposal_id
        return self._request("POST", f"/api/videos/{video_id}/tts/fish", payload=body, timeout=600)

    def tts_check(self, video_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/api/videos/{video_id}/tts/check")

    def tts_transcribe(self, video_id: str, audio: bytes, lang: str = "fr") -> Dict[str, Any]:
        return self._multipart(
            f"/api/videos/{video_id}/tts/transcribe?lang={lang}", {"file": "skip"}, [("file", "audio.mp3", audio)]
        )

    def fetch(self, audio_path: str) -> bytes:
        """Fetch a file the API serves itself (e.g. /downloads/tts/xxx.mp3)."""
        url = self.base + (audio_path if audio_path.startswith("/") else "/" + audio_path)
        try:
            with urllib.request.urlopen(url, timeout=180) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise NouveauError(e.code, e.read().decode("utf-8", errors="ignore")[:400], audio_path) from e
        except Exception as e:
            raise NouveauError(0, str(e), audio_path) from e

    # ------------------------------------------------------------------ jobs
    def job(self, job_id: str) -> Dict[str, Any]:
        last: Optional[NouveauError] = None
        for path in (f"/api/pipeline/jobs/{job_id}", f"/api/jobs/{job_id}"):
            try:
                return self._request("GET", path, timeout=30)
            except NouveauError as e:
                last = e
        raise last or NouveauError(404, "job introuvable", job_id)

    def poll_job(self, job_id: str, interval: float = 2.0, poll_sec: int = 900) -> Dict[str, Any]:
        deadline = time.time() + poll_sec
        last: Dict[str, Any] = {}
        while time.time() < deadline:
            last = self.job(job_id)
            status = str(last.get("status") or last.get("state") or "").lower()
            if status in ("done", "completed", "succeeded", "success", "finished"):
                return last
            if status in ("failed", "error", "cancelled"):
                return last
            time.sleep(max(0.5, interval))
        last["poll_timeout"] = True
        return last


def words_of(transcript: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Flatten the Deepgram segments into [{w, s, e}] (punctuated spelling kept)."""
    out: List[Dict[str, Any]] = []
    for seg in transcript or []:
        for w in seg.get("words") or []:
            text = str(w.get("word") or "").strip()
            if not text:
                continue
            out.append({"w": text, "s": float(w.get("start") or 0.0), "e": float(w.get("end") or 0.0)})
    return out
