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
import re
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
ELEVENLABS_SPEED = 1.15
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
        speed: float = ELEVENLABS_SPEED,
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


_ADV_OPT = (
    r"(?:toujours\s+|jamais\s+|pas\s+|plus\s+|du\s+tout\s+|vite\s+|enfin\s+|vraiment\s+|"
    r"très\s+|si\s+|trop\s+|assez\s+|plutôt\s+|peu\s+|un\s+peu\s+|"
    r"toute\s+|tout\s+|complètement\s+|totalement\s+|carrément\s+|franchement\s+|"
    r"extrêmement\s+|absolument\s+|immédiatement\s+|aussitôt\s+|presque\s+|"
    r"encore\s+|déjà\s+|bien\s+|mal\s+|tellement\s+|simplement\s+|juste\s+|même\s+|soudain\s+)*"
)

# Every French reflexive past participle ending in -ée after "je (ne) me suis" is
# unambiguously 1st-person feminine singular (invariable COI reflexives like
# "je me suis demandé" end in -é, never -ée). Add non-ée feminine participles too.
_FEM_REFL_PP = (
    r"(?:[a-zàâçéèêëîïôûùüÿœ]{2,}ée|"
    r"remise|assise|rendue|sentie|souvenue|aperçue|inscrite|mise|endormie|"
    r"évanouie|enfuie|battue|défendue|plainte|servie|raidie|accroupie|blottie|"
    r"repartie|ouverte|couverte|découverte|tue|faite\s+avoir)"
)

# Keep masculine reflexive participles strictly curated to direct-object reflexives
# so invariable COI reflexives ("je me suis demandé", "je me suis rendu compte",
# "je me suis servi un verre") never false-positive on female narrators.
_MASC_REFL_PP = (
    r"(?:remis|assis|levé|rendu(?!\s+compte)|senti|retrouvé|marié|fiancé|habillé|"
    r"installé|approché|échappé|trompé|souvenu|aperçu|inscrit|"
    r"mis(?!\s+(?:un|une|le|la|les|du|de\s+la|des|mon|ma|mes)\b)|"
    r"tourné|retourné|arrêté|penché|précipité|caché|réveillé|"
    r"endormi|évanoui|enfui|battu|défendu|plaint|occupé|"
    r"inquiété|habitué|effondré|énervé|fâché|décidé|lancé|figé|raidi|"
    r"allongé|accroupi|jeté|blotti|reparti|réfugié)"
)

_FEM_EE_NON_NOUN = r"(?!(?:idée|année|journée|soirée|matinée|durée)\b)[a-zàâçéèêëîïôûùüÿœ]{2,}ée"

_FEM_ADJ_PP = (
    rf"(?:{_FEM_EE_NON_NOUN}|"
    r"seule|sûre|certaine|prête|assise|accroupie|heureuse|contente|surprise|enceinte|"
    r"petite|grande|folle|amoureuse|jalouse|furieuse|inquiète|perdue|confuse|"
    r"fière|naïve|impatiente|patiente|curieuse|nerveuse|sérieuse|malheureuse|chanceuse|"
    r"convaincue|idiote|muette|discrète|vivante|présente|absente|fichue|foutue)"
)

_MASC_ADJ_PP = (
    r"(?:seul|sûr|certain|prêt|assis|allongé|accroupi|fatigué|épuisé|choqué|terrifié|effrayé|"
    r"heureux|content|surpris|petit|grand|fou|amoureux|jaloux|"
    r"furieux|désolé|inquiet|perdu|bloqué|coincé|habitué|obligé|forcé|"
    r"confus|sidéré|bouleversé|dégoûté|soulagé|"
    r"gêné|embarrassé|humilié|vexé|blessé|touché|ému|stressé|angoissé|"
    r"paniqué|paralysé|figé|tétanisé|fier|naïf|impatient|patient|curieux|"
    r"nerveux|sérieux|malheureux|chanceux|convaincu|persuadé|déterminé|"
    r"censé|supposé|invité|viré|embauché|accepté|refusé|amusé|intrigué|"
    r"caché|idiot|muet|discret|vivant|présent|absent|fichu|foutu|trempé|glacé|piégé)"
)

_FEM_STATE_OR_MOTION_PP = (
    rf"(?:{_FEM_ADJ_PP}|venue|sortie|partie|descendue|morte|repartie|revenue|devenue|parvenue)"
)

_MASC_STATE_OR_MOTION_PP = (
    rf"(?:{_MASC_ADJ_PP}|arrivé|allé|venu|sorti|parti|entré|resté|tombé|passé|retourné|monté|descendu|né|mort|rentré|reparti|revenu|devenu)"
)

_STATE_VERB_FEM = (
    r"(?:j['’](?:étais|avais(?:\s+pas)?\s+l['’]air)|"
    r"je\s+(?:ne\s+|n['’])?(?:étais|suis|serais|deviens|reste|me\s+sens|me\s+sentais|paraissais|semblais))"
    r"(?:\s+(?:pas|plus|jamais|toujours|encore|vraiment))?"
    r"(?:\s+(?:devenue|restée|tombée))?"
)

_STATE_VERB_MASC = (
    r"(?:j['’](?:étais|avais(?:\s+pas)?\s+l['’]air)|"
    r"je\s+(?:ne\s+|n['’])?(?:étais|suis|serais|deviens|reste|me\s+sens|me\s+sentais|paraissais|semblais))"
    r"(?:\s+(?:pas|plus|jamais|toujours|encore|vraiment))?"
    r"(?:\s+(?:devenu|resté|tombé))?"
)

_FEM_PATTERNS: List[Tuple[re.Pattern[str], int, str]] = [
    (
        re.compile(rf"\bje\s+(?:ne\s+)?me\s+suis\s+{_ADV_OPT}{_FEM_REFL_PP}\b", re.IGNORECASE),
        3,
        "accord réfléchi 1re pers. fém.",
    ),
    (
        re.compile(
            rf"\b{_STATE_VERB_FEM}\s+{_ADV_OPT}{_FEM_STATE_OR_MOTION_PP}\b",
            re.IGNORECASE,
        ),
        3,
        "attribut/participe 1re pers. fém.",
    ),
    (
        re.compile(
            rf"(?:^|[.!?…:;]\s+|\b(?:et|mais|puis|alors|quand|lorsque|comme|car)\s+)"
            rf"(?:il|elle|on|ils|elles|mon\s+\w+|ma\s+\w+|le\s+\w+|la\s+\w+|un\s+\w+|une\s+\w+)\s+"
            rf"(?:ne\s+)?m['’](?:a|ont|avait|avaient)\s+{_ADV_OPT}[a-zàâçéèêëîïôûùüÿœ]{{2,}}ée\b",
            re.IGNORECASE,
        ),
        3,
        "accord COD m'a -ée 1re pers. fém.",
    ),
    (
        re.compile(
            r"\b(?:je\s+(?:marchais|rentrais|vivais|habitais|dormais|voyageais|travaillais|restais|mangeais|pleurais)|"
            r"j['’](?:étais\s+venue|habitais|attendais))\s+(?:toute\s+)?seule\b",
            re.IGNORECASE,
        ),
        3,
        "verbe + seule 1re pers. fém.",
    ),
    (
        re.compile(
            rf"\b(?:j['’]ai\s+\w+|j['’]\w+ais|je\s+\w+)[^.!?«»\"“”]{{0,45}},\s*{_ADV_OPT}{_FEM_ADJ_PP}\b",
            re.IGNORECASE,
        ),
        3,
        "adjectif apposé 1re pers. fém.",
    ),
    (
        re.compile(
            rf"(?:^|[.!?…]\s+){_ADV_OPT}{_FEM_ADJ_PP}(?:\s+[^,.!?«»\"“”]{{1,28}})?,\s*(?:je\b|j['’])",
            re.IGNORECASE,
        ),
        3,
        "adjectif détaché en tête 1re pers. fém.",
    ),
    (
        re.compile(
            r"\b(?:je\s+suis\s+une\s+(?:femme|fille|jeune\s+femme|jeune\s+fille|ado|adolescente|lycéenne|collégienne|mère|maman|épouse|cliente|patiente|étudiante|serveuse|infirmière|enseignante|voisine)|"
            r"je\s+(?:ne\s+)?suis\s+pas\s+un\s+(?:homme|garçon|mec|gars)|"
            r"en\s+tant\s+que\s+(?:femme|mère|maman|fille|épouse|jeune\s+femme)|"
            r"une\s+(?:femme|fille)\s+comme\s+moi)\b",
            re.IGNORECASE,
        ),
        4,
        "auto-identification fém.",
    ),
    (
        re.compile(
            r"\b(?:mon\s+(?:mari|petit\s+ami|copain|ex-mari|ex-copain|fiancé|chéri|petit\s+copain|vagin|utérus|soutien-gorge|chemisier|sac\s+à\s+main|maquillage|accouchement)|"
            r"mes\s+règles|"
            r"me\s+suis\s+fait\s+faire\s+les\s+ongles|faire\s+mes\s+ongles|ma\s+manucure|ma\s+pédicure|"
            r"ma\s+technicienne|ma\s+robe|ma\s+jupe|ma\s+grossesse)\b",
            re.IGNORECASE,
        ),
        2,
        "contexte narratrice fém.",
    ),
]

_MASC_PATTERNS: List[Tuple[re.Pattern[str], int, str]] = [
    (
        re.compile(rf"\bje\s+(?:ne\s+)?me\s+suis\s+{_ADV_OPT}{_MASC_REFL_PP}\b", re.IGNORECASE),
        3,
        "accord réfléchi 1re pers. masc.",
    ),
    (
        re.compile(
            rf"\b{_STATE_VERB_MASC}\s+{_ADV_OPT}{_MASC_STATE_OR_MOTION_PP}\b",
            re.IGNORECASE,
        ),
        3,
        "attribut/participe 1re pers. masc.",
    ),
    (
        re.compile(
            r"\b(?:je\s+(?:marchais|rentrais|vivais|habitais|dormais|voyageais|travaillais|restais|mangeais)|"
            r"j['’](?:étais\s+venu|habitais|attendais))\s+(?:tout\s+)?seul\b",
            re.IGNORECASE,
        ),
        3,
        "verbe + seul 1re pers. masc.",
    ),
    (
        re.compile(
            rf"\b(?:j['’]ai\s+\w+|j['’]\w+ais|je\s+\w+)[^.!?«»\"“”]{{0,45}},\s*{_ADV_OPT}{_MASC_ADJ_PP}\b",
            re.IGNORECASE,
        ),
        3,
        "adjectif apposé 1re pers. masc.",
    ),
    (
        re.compile(
            rf"(?:^|[.!?…]\s+){_ADV_OPT}{_MASC_ADJ_PP}(?:\s+[^,.!?«»\"“”]{{1,28}})?,\s*(?:je\b|j['’])",
            re.IGNORECASE,
        ),
        3,
        "adjectif détaché en tête 1re pers. masc.",
    ),
    (
        re.compile(
            r"\b(?:je\s+suis\s+un\s+(?:homme|gars|mec|jeune\s+homme|garçon|ado|adolescent|lycéen|père|papa|mari|client|patient|étudiant|serveur|infirmier|voisin)|"
            r"je\s+(?:ne\s+)?suis\s+pas\s+une\s+(?:femme|fille)|"
            r"en\s+tant\s+qu['’]homme|en\s+tant\s+que\s+(?:père|papa|mari|garçon)|"
            r"un\s+(?:homme|gars|mec)\s+comme\s+moi)\b",
            re.IGNORECASE,
        ),
        4,
        "auto-identification masc.",
    ),
    (
        re.compile(
            r"\b(?:ma\s+(?:femme|petite\s+amie|copine|ex-femme|ex-copine|fiancée|chérie|petite\s+copine|meuf)|"
            r"ma\s+barbe|mon\s+costume|ma\s+cravate)\b",
            re.IGNORECASE,
        ),
        2,
        "contexte narrateur masc.",
    ),
]

_DIRECT_ADDR_FEM = re.compile(
    r"\bm['’](?:a|ont|avait|avaient)?\s*(?:dit|murmuré|chuchoté|sifflé|crié|hurlé|lancé|répondu|demandé|appelée?)\b"
    r"[^.!?«»\"“”]{0,30}[«\"“]\s*(?:bonne\s+fille|petite\s+idiote|ma\s+belle|ma\s+jolie|ma\s+petite|pauvre\s+fille|mademoiselle|madame)\b",
    re.IGNORECASE,
)

_DIRECT_ADDR_MASC = re.compile(
    r"\bm['’](?:a|ont|avait|avaient)?\s*(?:dit|murmuré|chuchoté|sifflé|crié|hurlé|lancé|répondu|demandé|appelé)\b"
    r"[^.!?«»\"“”]{0,30}[«\"“]\s*(?:bon\s+garçon|petit\s+idiot|mon\s+grand|mon\s+gars|mon\s+petit|pauvre\s+type|monsieur|jeune\s+homme)\b",
    re.IGNORECASE,
)

_IMPERSONAL_IL = re.compile(
    r"\bil\s+(?:y\s+a|y\s+avait|y\s+aura|faut|fallait|faudra|faudrait|semble|semblait|"
    r"paraît|paraissait|s['’]agit|s['’]agissait|suffit|suffisait|pleut|pleuvait|neige|vaut\s+mieux|"
    r"est\s+\d+|était\s+\d+|est\s+(?:tard|tôt|temps|possible|impossible|important|évident|clair|vrai|faux))\b",
    re.IGNORECASE,
)

_OPENING_FEM_LEAD = re.compile(
    r"^\s*(?:[^.!?]{0,65}\b)?(?:elle|cette\s+(?:femme|fille|jeune\s+femme|jeune\s+fille|cliente)|"
    r"une\s+(?:femme|fille|jeune\s+femme|jeune\s+fille|adolescente|lycéenne)|sa\s+sœur)\b",
    re.IGNORECASE,
)

_FR_STOPWORDS = frozenset(
    {
        "je", "tu", "il", "elle", "nous", "vous", "ils", "elles",
        "le", "la", "les", "un", "une", "des", "du", "au", "aux",
        "dans", "avec", "pour", "mais", "pas", "plus", "sur", "que",
        "qui", "quoi", "dont", "où", "est", "sont", "était", "étaient",
        "avait", "avaient", "suis", "sommes", "êtes", "ma", "mes", "ta",
        "tes", "sa", "ses", "leur", "leurs", "cet", "cette", "ces",
        "tout", "tous", "toute", "toutes", "comme", "quand", "alors",
        "puis", "sans", "chez", "vers", "très", "bien", "même", "encore",
        "déjà", "jamais", "toujours", "rien", "oui", "moi", "toi", "lui",
        "eux", "ne", "se", "te",
    }
)

_EN_STOPWORDS = frozenset(
    {
        "the", "and", "that", "with", "for", "was", "were", "have", "has",
        "had", "not", "but", "they", "them", "their", "there", "then", "than",
        "she", "her", "hers", "his", "him", "himself", "herself", "you",
        "your", "yours", "from", "into", "onto", "about", "when", "what",
        "where", "which", "while", "who", "whom", "whose", "out", "our",
        "my", "myself", "would", "could", "should", "will", "did", "didn",
        "don", "doesn", "wasn", "weren", "couldn", "wouldn", "can", "just",
        "been", "being", "after", "before", "because", "through", "over",
        "under", "again", "back", "still", "even", "only", "other", "another",
        "some", "any", "every", "all", "both", "each", "few", "more", "most",
        "such", "own", "same", "so", "too", "very", "here", "how", "why",
    }
)

_EN_FEM_PATTERNS: List[Tuple[re.Pattern[str], int, str]] = [
    (
        re.compile(
            r"\b(?:I(?:\s+am|['’]m|\s+was)\s+(?:just\s+|only\s+|still\s+)?(?:a|an|the\s+only)\s+"
            r"(?:[a-z0-9-]+\s+){0,2}(?:woman|girl|lady|mother|mom|mum|wife|fiancée|bride|daughter|"
            r"sister|granddaughter|niece|aunt|waitress|actress|hostess|queen|princess|"
            r"maid\s+of\s+honor|bridesmaid|schoolgirl|sorority\s+girl)|"
            r"I\s*\(\s*\d{1,2}\s*f\s*\)|I(?:\s+am|['’]m|\s+was)\s+\d{1,2}\s*f|"
            r"as\s+a\s+(?:[a-z0-9-]+\s+){0,2}(?:woman|girl|mother|mom|mum|wife|daughter|sister)|"
            r"a\s+(?:woman|girl|mother|wife)\s+like\s+me|"
            r"I(?:\s+am|['’]m|\s+was|\s+got)\s+(?:\d+\s+(?:weeks?|months?)\s+)?pregnant)\b",
            re.IGNORECASE,
        ),
        4,
        "1st-person female self-ID",
    ),
    (
        re.compile(
            r"\b(?:my\s+(?:[a-z-]+\s+)?(?:husband|boyfriend|ex-husband|ex-boyfriend|fiancé|hubby|"
            r"dress|skirt|gown|blouse|high\s+heels|bra|bikini|leggings|tights|purse|handbag|clutch|"
            r"makeup|mascara|lipstick|eyeliner|manicure|pedicure|pregnancy|uterus|womb|period|"
            r"veil|tiara|bridal\s+shower|bachelorette|maid\s+of\s+honor|bridesmaids?|ponytail)|"
            r"(?:doing|did|put\s+on|wiping\s+off|ruined)\s+my\s+(?:makeup|lipstick|mascara|nails)|"
            r"got\s+my\s+nails\s+done|"
            r"I\s+(?:found\s+her\s+(?:locked\s+)?in\s+a\s+bathroom\s+stall|"
            r"walked\s+into\s+the\s+girls['’]?\s+(?:bathroom|restroom|locker\s+room)|"
            r"ran\s+into\s+the\s+girls['’]?\s+(?:bathroom|restroom)|"
            r"decided\s+to\s+become\s+friends\s+with\s+the\s+girl))\b",
            re.IGNORECASE,
        ),
        2,
        "1st-person female context",
    ),
]

_EN_MASC_PATTERNS: List[Tuple[re.Pattern[str], int, str]] = [
    (
        re.compile(
            r"\b(?:I(?:\s+am|['’]m|\s+was)\s+(?:just\s+|only\s+|still\s+)?(?:a|an|the\s+only)\s+"
            r"(?:[a-z0-9-]+\s+){0,2}(?:man|guy|boy|gentleman|father|dad|husband|groom|son|"
            r"brother|grandson|nephew|uncle|waiter|actor|king|prince|best\s+man|groomsman|"
            r"schoolboy|frat\s+boy)|"
            r"I\s*\(\s*\d{1,2}\s*m\s*\)|I(?:\s+am|['’]m|\s+was)\s+\d{1,2}\s*m|"
            r"as\s+a\s+(?:[a-z0-9-]+\s+){0,2}(?:man|guy|boy|father|dad|husband|son|brother)|"
            r"a\s+(?:man|guy|boy|father|husband)\s+like\s+me)\b",
            re.IGNORECASE,
        ),
        4,
        "1st-person male self-ID",
    ),
    (
        re.compile(
            r"\b(?:my\s+(?:[a-z-]+\s+)?(?:wife|girlfriend|ex-wife|ex-girlfriend|fiancée|bride|"
            r"beard|stubble|mustache|moustache|tuxedo|tux|necktie|bow\s+tie|boxers|briefs|"
            r"barber|groomsmen|best\s+man|bachelor\s+party)|"
            r"(?:shaving|trimmed|stroked)\s+my\s+(?:beard|stubble))\b",
            re.IGNORECASE,
        ),
        2,
        "1st-person male context",
    ),
]

_EN_DIRECT_ADDR_FEM = re.compile(
    r"\b(?:called|told|whispered\s+to|said\s+to|yelled\s+at|shouted\s+at|asked|texted)\s+me\b"
    r"[^.!?\"“”\n]{0,35}[\"“]\s*(?:good\s+girl|baby\s+girl|sweetie|sweetheart|miss|ma['’]am|"
    r"young\s+lady|princess|sis|bitch|queen)\b",
    re.IGNORECASE,
)

_EN_DIRECT_ADDR_MASC = re.compile(
    r"\b(?:called|told|whispered\s+to|said\s+to|yelled\s+at|shouted\s+at|asked|texted)\s+me\b"
    r"[^.!?\"“”\n]{0,35}[\"“]\s*(?:good\s+boy|sir|mister|mr\.|young\s+man|dude|bro|brother|"
    r"buddy|pal|son|king|bastard)\b",
    re.IGNORECASE,
)

_EN_OPENING_FEM_LEAD = re.compile(
    r"^\s*(?:[^.!?]{0,65}\b)?(?:she|this\s+(?:woman|girl|teenage\s+girl|young\s+woman)|"
    r"a\s+(?:woman|girl|teenage\s+girl|young\s+woman)|her\s+sister)\b",
    re.IGNORECASE,
)

_EN_FEM_GIVEN_NAMES = frozenset(
    {
        "abigail", "alice", "allison", "alyssa", "amanda", "amber", "amelia", "amy", "andrea",
        "angela", "anna", "ashley", "audrey", "ava", "bella", "beth", "brenda", "brianna",
        "brittany", "brooke", "camille", "caroline", "cassandra", "catherine", "charlotte",
        "chloe", "christina", "claire", "clara", "courtney", "crystal", "danielle", "diana",
        "elena", "elizabeth", "ella", "emily", "emma", "erica", "erin", "eva", "evelyn",
        "fiona", "gabriella", "gianna", "hannah", "harper", "hailey", "haley", "hazel",
        "heather", "heidi", "holly", "isabella", "isabelle", "isla", "ivy", "jacqueline",
        "jade", "jasmine", "JENNA".lower(), "jennifer", "jessica", "jill", "julia", "julie",
        "kaitlyn", "karen", "kate", "katherine", "katie", "kayla", "kelly", "kendall",
        "kimberly", "kylie", "laura", "lauren", "layla", "leah", "lena", "liliana", "lillian",
        "lily", "lindsay", "lisa", "lucy", "lydia", "madeline", "madison", "margaret", "maria",
        "marie", "megan", "melanie", "melissa", "mia", "michelle", "mila", "molly", "monica",
        "naomi", "natalie", "natasha", "nicole", "nina", "nora", "olivia", "paige", "penelope",
        "piper", "rachel", "rebecca", "riley", "ruby", "sabrina", "sadie", "samantha", "sara",
        "sarah", "savannah", "scarlett", "serena", "shannon", "shelby", "sienna", "sloane",
        "sofia", "sophia", "sophie", "stella", "stephanie", "sydney", "tara", "taylor",
        "tiffany", "valerie", "vanessa", "veronica", "victoria", "violet", "vivian", "wendy",
        "whitney", "zoe", "zoey",
    }
)

_EN_MASC_GIVEN_NAMES = frozenset(
    {
        "aaron", "adam", "adrian", "aidan", "aiden", "alex", "alexander", "andrew", "anthony",
        "arthur", "austin", "ben", "benjamin", "brandon", "brian", "bryan", "caleb", "cameron",
        "carlos", "carter", "charles", "charlie", "chase", "chris", "christian", "christopher",
        "cole", "colin", "connor", "CONNOR".lower(), "cooper", "craig", "damian", "dan",
        "daniel", "david", "dean", "derek", "devin", "dominic", "dylan", "edward", "eli",
        "elijah", "elliot", "eric", "ethan", "evan", "felix", "gabriel", "garrett", "gavin",
        "george", "grant", "greg", "gregory", "harrison", "henry", "hudson", "hunter", "ian",
        "isaac", "isaiah", "jack", "jackson", "jacob", "jake", "james", "jason", "jayden",
        "jeff", "jeffrey", "jeremy", "jesse", "john", "jonah", "jonathan", "jordan", "joseph",
        "josh", "joshua", "julian", "justin", "keith", "kevin", "kyle", "landon", "leo",
        "levi", "liam", "logan", "lucas", "luke", "marcus", "mason", "matt", "matthew",
        "max", "michael", "mike", "miles", "mitchell", "nathan", "nathaniel", "nick",
        "nicholas", "noah", "nolan", "oliver", "oscar", "owen", "parker", "patrick", "paul",
        "peter", "philip", "preston", "raymond", "richard", "robert", "roman", "ryan", "sam",
        "samuel", "scott", "sean", "sebastian", "seth", "shane", "shaun", "simon", "spencer",
        "stephen", "steve", "steven", "theo", "theodore", "thomas", "tim", "timothy", "travis",
        "trevor", "tristan", "tyler", "victor", "vincent", "wesley", "william", "wyatt",
        "xavier", "zach", "zachary",
    }
)


def detect_text_language(text: str) -> str:
    """Detect whether narration text is English ('en') or French ('fr', default)."""
    cleaned = re.sub(r"\[[^\]\n]{1,60}\]|<[^>]{1,60}>", " ", text or "")
    tokens = re.findall(r"[a-zàâçéèêëîïôûùüÿœ]+", cleaned.lower())
    if not tokens:
        return "fr"
    fr_hits = sum(1 for tok in tokens if tok in _FR_STOPWORDS)
    en_hits = sum(1 for tok in tokens if tok in _EN_STOPWORDS)
    if en_hits >= 2 and en_hits > fr_hits * 1.2:
        return "en"
    return "fr"


def _detect_english_narrator_voice(text: str, title: str = "") -> Dict[str, Any]:
    raw = f"{title or ''}\n{text or ''}".strip()
    cleaned = re.sub(r"\[[^\]\n]{1,60}\]|<[^>]{1,60}>", " ", raw)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    # Strip double-quoted speech (keep apostrophes inside English contractions like don't / I'm).
    unquoted = re.sub(r"“[^”]*”|\"[^\"\n]*\"|«[^»]*»", " ", cleaned)

    i_count = len(re.findall(r"\b(?:I|I['’](?:m|ve|d|ll)|my|me|myself)\b", unquoted, flags=re.IGNORECASE))
    you_count = len(re.findall(r"\b(?:you|your|yours|yourself|you['’](?:re|ve|d|ll))\b", unquoted, flags=re.IGNORECASE))
    she_count = len(re.findall(r"\b(?:she|her|hers|herself|she['’](?:s|d|ll))\b", unquoted, flags=re.IGNORECASE))
    he_count = len(re.findall(r"\b(?:he|him|his|himself|he['’](?:s|d|ll))\b", unquoted, flags=re.IGNORECASE))

    if i_count >= 3:
        pov = "first"
    elif you_count >= 4 and you_count > she_count and you_count > he_count:
        pov = "second"
    else:
        pov = "third"

    fem_score = 0
    masc_score = 0
    reasons: List[str] = []

    for pat, weight, label in _EN_FEM_PATTERNS:
        for m in pat.finditer(unquoted):
            fem_score += weight
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+{weight}F ({label}: '{snippet}')")

    for pat, weight, label in _EN_MASC_PATTERNS:
        for m in pat.finditer(unquoted):
            masc_score += weight
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+{weight}M ({label}: '{snippet}')")

    if i_count >= 3:
        for m in re.finditer(r"\b(?:my\s+name\s+is|they\s+call\s+me|call\s+me)\s+([A-Z][a-z]{2,15})\b", unquoted):
            nm = m.group(1)
            low = nm.lower()
            if low in _EN_FEM_GIVEN_NAMES:
                fem_score += 4
                reasons.append(f"+4F (1st-person female name: '{nm}')")
            elif low in _EN_MASC_GIVEN_NAMES:
                masc_score += 4
                reasons.append(f"+4M (1st-person male name: '{nm}')")

        for m in _EN_DIRECT_ADDR_FEM.finditer(cleaned):
            fem_score += 3
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+3F (vocative addressed to narrator: '{snippet}')")
        for m in _EN_DIRECT_ADDR_MASC.finditer(cleaned):
            masc_score += 3
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+3M (vocative addressed to narrator: '{snippet}')")

        # Direct vocative by given name inside dialogue ("Don't do anything, Harper.") where that
        # name never appears as a 3rd-person character outside quotes -> it addresses "I".
        seen_vocatives = set()
        for g1, g2 in re.findall(r"“([^”\n]{2,180})”|\"([^\"\n]{2,180})\"", cleaned):
            q = (g1 or g2).strip()
            candidates: List[str] = []
            for vm in re.finditer(
                r"(?:,\s*([A-Z][a-z]{2,15})\s*[.!?…]*$|"
                r"^(?:Hey|Look|Listen|Please|Stop|Wait|No|Oh|Sorry|Thanks|Thank\s+you),\s+([A-Z][a-z]{2,15})\b|"
                r"^([A-Z][a-z]{2,15}),\s+(?:please|don['’]t|stop|listen|look|wait|you|I)\b)",
                q,
            ):
                cand = vm.group(1) or vm.group(2) or vm.group(3)
                if cand:
                    candidates.append(cand)
            for cand in candidates:
                low = cand.lower()
                if low in seen_vocatives:
                    continue
                if re.search(rf"\b{re.escape(cand)}\b", unquoted):
                    continue
                if low in _EN_FEM_GIVEN_NAMES:
                    seen_vocatives.add(low)
                    fem_score += 3
                    reasons.append(f"+3F (narrator vocative name: '{cand}')")
                elif low in _EN_MASC_GIVEN_NAMES:
                    seen_vocatives.add(low)
                    masc_score += 3
                    reasons.append(f"+3M (narrator vocative name: '{cand}')")

    if fem_score == 0 and masc_score == 0:
        fem_2 = re.findall(
            r"\byour\s+(?:husband|boyfriend|ex-husband|ex-boyfriend|fiancé|dress|skirt|pregnancy|makeup)\b",
            unquoted,
            flags=re.IGNORECASE,
        )
        masc_2 = re.findall(
            r"\byour\s+(?:wife|girlfriend|ex-wife|ex-girlfriend|fiancée|beard|tuxedo)\b",
            unquoted,
            flags=re.IGNORECASE,
        )
        if fem_2:
            fem_score += len(fem_2) * 2
            reasons.append(f"+{len(fem_2)*2}F (2nd-person female cue: {fem_2[:2]})")
        if masc_2:
            masc_score += len(masc_2) * 2
            reasons.append(f"+{len(masc_2)*2}M (2nd-person male cue: {masc_2[:2]})")

        if fem_score == 0 and masc_score == 0 and i_count < 3 and you_count < 3:
            body_head = re.sub(r"\[[^\]\n]{1,60}\]|<[^>]{1,60}>", " ", text or "").strip()[:180]
            fem_lead = bool(_EN_OPENING_FEM_LEAD.search(body_head))
            if she_count >= 5 and (she_count >= he_count * 1.4 or (she_count > he_count and fem_lead)):
                fem_score += 3
                reasons.append(f"+3F (3rd-person female lead: she/her={she_count} vs he/him={he_count})")

    is_female = fem_score > masc_score
    return {
        "lang": "en",
        "gender": "female" if is_female else "male",
        "pov": pov,
        "voiceId": ELEVENLABS_VOICE_LEA if is_female else ELEVENLABS_VOICE,
        "voiceName": "Léa" if is_female else "Hugo",
        "femaleScore": fem_score,
        "maleScore": masc_score,
        "reasons": reasons[:8],
    }


def detect_narrator_voice(text: str, title: str = "") -> Dict[str, Any]:
    """Analyze French or English phrasing, POV, and cues to choose Léa (female) or Hugo (male).

    Strips TTS stage tags ([pause], <stress>, etc.) and quoted dialogue (« ... », “...”, "...")
    so secondary characters speaking in quotes do not override the narrator's own gender.
    """
    raw = f"{title or ''}\n{text or ''}".strip()
    if detect_text_language(raw) == "en":
        return _detect_english_narrator_voice(text, title)

    cleaned = re.sub(r"\[[^\]\n]{1,45}\]|<[^>]{1,45}>", " ", raw)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    # Strip quoted speech where other characters may speak in first person.
    unquoted = re.sub(r"«[^»]*»|“[^”]*”|\"[^\"\n]*\"", " ", cleaned)

    je_count = len(re.findall(r"\b(?:je|j['’])\b", unquoted, flags=re.IGNORECASE))
    tu_count = len(re.findall(r"\btu\b", unquoted, flags=re.IGNORECASE))
    elle_count = len(re.findall(r"\belle\b", unquoted, flags=re.IGNORECASE))
    il_all = len(re.findall(r"\bil\b", unquoted, flags=re.IGNORECASE))
    il_subj = max(0, il_all - len(_IMPERSONAL_IL.findall(unquoted)))

    if je_count >= 3:
        pov = "first"
    elif tu_count >= 4 and tu_count > elle_count and tu_count > il_subj:
        pov = "second"
    else:
        pov = "third"

    fem_score = 0
    masc_score = 0
    reasons: List[str] = []

    for pat, weight, label in _FEM_PATTERNS:
        for m in pat.finditer(unquoted):
            fem_score += weight
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+{weight}F ({label}: '{snippet}')")

    for pat, weight, label in _MASC_PATTERNS:
        for m in pat.finditer(unquoted):
            masc_score += weight
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+{weight}M ({label}: '{snippet}')")

    # Vocatives explicitly addressed to the 1st-person narrator ("Il m'a murmuré : « Bonne fille »")
    if je_count >= 3:
        for m in _DIRECT_ADDR_FEM.finditer(cleaned):
            fem_score += 3
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+3F (vocatif adressé à la narratrice: '{snippet}')")
        for m in _DIRECT_ADDR_MASC.finditer(cleaned):
            masc_score += 3
            snippet = re.sub(r"\s+", " ", m.group(0)).strip()
            reasons.append(f"+3M (vocatif adressé au narrateur: '{snippet}')")

    # Fallback for 2nd/3rd person scripts when there are no 1st-person cues:
    if fem_score == 0 and masc_score == 0:
        fem_23 = re.findall(
            r"\b(?:tu\s+es\s+" + _ADV_OPT + _FEM_ADJ_PP + r"|repartirais\s+avec\s+lui|sortirais\s+avec\s+lui|ton\s+(?:mari|copain|petit\s+ami|fiancé))\b",
            unquoted,
            flags=re.IGNORECASE,
        )
        masc_23 = re.findall(
            r"\b(?:tu\s+es\s+" + _ADV_OPT + _MASC_ADJ_PP + r"|repartirais\s+avec\s+elle|sortirais\s+avec\s+elle|ta\s+(?:femme|copine|petite\s+amie|fiancée))\b",
            unquoted,
            flags=re.IGNORECASE,
        )
        if fem_23:
            fem_score += len(fem_23) * 2
            reasons.append(f"+{len(fem_23)*2}F (2e pers. fém.: {fem_23[:2]})")
        if masc_23:
            masc_score += len(masc_23) * 2
            reasons.append(f"+{len(masc_23)*2}M (2e pers. masc.: {masc_23[:2]})")

        if fem_score == 0 and masc_score == 0 and je_count < 3 and tu_count < 3:
            # 3rd-person story centered on a female protagonist ("Elle marche seule...", "Tout le monde pensait que sa sœur...")
            body_head = re.sub(r"\[[^\]\n]{1,45}\]|<[^>]{1,45}>", " ", text or "").strip()[:180]
            fem_lead = bool(_OPENING_FEM_LEAD.search(body_head))
            if elle_count >= 5 and (elle_count >= il_subj * 1.4 or (elle_count > il_subj and fem_lead)):
                fem_score += 3
                reasons.append(f"+3F (protagoniste 3e pers. fém.: elle={elle_count} vs il={il_subj})")

    is_female = fem_score > masc_score
    return {
        "lang": "fr",
        "gender": "female" if is_female else "male",
        "pov": pov,
        "voiceId": ELEVENLABS_VOICE_LEA if is_female else ELEVENLABS_VOICE,
        "voiceName": "Léa" if is_female else "Hugo",
        "femaleScore": fem_score,
        "maleScore": masc_score,
        "reasons": reasons[:8],
    }
