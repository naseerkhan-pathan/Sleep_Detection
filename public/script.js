const video = document.getElementById("video");
const statusText = document.getElementById("status");
const alarm = document.getElementById("alarm");

const thresholdRange = document.getElementById("thresholdRange");
const thresholdValue = document.getElementById("thresholdValue");
const delayRange = document.getElementById("delayRange");
const delayValue = document.getElementById("delayValue");
const alarmToggle = document.getElementById("alarmToggle");
const recalibrateBtn = document.getElementById("recalibrateBtn");
const downloadBtn = document.getElementById("downloadBtn");

const earValue = document.getElementById("earValue");
const blinkCount = document.getElementById("blinkCount");
const drowsyEvents = document.getElementById("drowsyEvents");
const drowsyDuration = document.getElementById("drowsyDuration");
const sessionDuration = document.getElementById("sessionDuration");
const eventLog = document.getElementById("eventLog");

const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

let EYE_THRESHOLD = Number(thresholdRange.value);
let ALERT_DELAY_MS = Number(delayRange.value) * 1000;

let audioUnlocked = false;
let calibrationMode = true;
let calibrationFrames = [];
let calibrationTargetFrames = 100;

let isEyeClosed = false;
let closedSince = null;
let drowsyStart = null;
let blinkFrames = 0;
let inDrowsyState = false;

const stats = {
    blinks: 0,
    drowsyEvents: 0,
    drowsyMs: 0,
    sessionStart: Date.now()
};

function unlockAudio() {
    if (audioUnlocked) return;

    alarm.play().then(() => {
        alarm.pause();
        alarm.currentTime = 0;
        audioUnlocked = true;
        appendLog("Audio unlocked and ready");
    }).catch(() => {
        appendLog("Tap anywhere once to enable alarm audio");
    });
}

document.addEventListener("click", unlockAudio, { once: true });

delayRange.addEventListener("input", () => {
    ALERT_DELAY_MS = Number(delayRange.value) * 1000;
    delayValue.textContent = Number(delayRange.value).toFixed(1);
});

thresholdRange.addEventListener("input", () => {
    EYE_THRESHOLD = Number(thresholdRange.value);
    thresholdValue.textContent = EYE_THRESHOLD.toFixed(2);
});

recalibrateBtn.addEventListener("click", () => {
    calibrationMode = true;
    calibrationFrames = [];
    setStatus("Calibrating baseline EAR... keep your eyes open", "pending");
    appendLog("Manual recalibration started");
});

downloadBtn.addEventListener("click", () => {
    const payload = {
        generatedAt: new Date().toISOString(),
        threshold: EYE_THRESHOLD,
        alertDelaySeconds: ALERT_DELAY_MS / 1000,
        alarmEnabled: alarmToggle.checked,
        stats: {
            blinks: stats.blinks,
            drowsyEvents: stats.drowsyEvents,
            drowsySeconds: Number((stats.drowsyMs / 1000).toFixed(2)),
            sessionSeconds: Number(((Date.now() - stats.sessionStart) / 1000).toFixed(2))
        }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sleep-seeker-report-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);

    appendLog("Session report downloaded");
});

function setStatus(text, state) {
    statusText.textContent = text;
    statusText.classList.remove("status-awake", "status-sleepy", "status-pending");

    if (state === "awake") statusText.classList.add("status-awake");
    else if (state === "sleepy") statusText.classList.add("status-sleepy");
    else statusText.classList.add("status-pending");
}

function appendLog(message) {
    const item = document.createElement("li");
    item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    eventLog.prepend(item);

    while (eventLog.children.length > 14) {
        eventLog.removeChild(eventLog.lastChild);
    }
}

function euclidean(p1, p2) {
    return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

function eyeAspectRatio(landmarks, points) {
    const top = (euclidean(landmarks[points[1]], landmarks[points[5]]) + euclidean(landmarks[points[2]], landmarks[points[4]])) / 2;
    const horizontal = euclidean(landmarks[points[0]], landmarks[points[3]]);
    return top / horizontal;
}

function updateStatsUI(avgEAR) {
    earValue.textContent = avgEAR.toFixed(3);
    blinkCount.textContent = String(stats.blinks);
    drowsyEvents.textContent = String(stats.drowsyEvents);
    drowsyDuration.textContent = `${(stats.drowsyMs / 1000).toFixed(1)}s`;
    sessionDuration.textContent = `${((Date.now() - stats.sessionStart) / 1000).toFixed(1)}s`;
}

function processCalibration(avgEAR) {
    calibrationFrames.push(avgEAR);

    if (calibrationFrames.length < calibrationTargetFrames) {
        setStatus(`Calibrating baseline... ${calibrationFrames.length}/${calibrationTargetFrames}`, "pending");
        return;
    }

    const baselineEAR = calibrationFrames.reduce((sum, v) => sum + v, 0) / calibrationFrames.length;
    const adaptiveThreshold = Math.min(0.32, Math.max(0.16, baselineEAR * 0.72));

    EYE_THRESHOLD = Number(adaptiveThreshold.toFixed(2));
    thresholdRange.value = String(EYE_THRESHOLD);
    thresholdValue.textContent = EYE_THRESHOLD.toFixed(2);

    calibrationMode = false;
    calibrationFrames = [];

    setStatus("Calibration done. Monitoring started", "awake");
    appendLog(`Auto threshold set to ${EYE_THRESHOLD.toFixed(2)} using baseline EAR ${baselineEAR.toFixed(3)}`);
}

function stopAlarm() {
    alarm.pause();
    alarm.currentTime = 0;
}

function processAwakeState(now) {
    if (isEyeClosed && blinkFrames >= 2) {
        stats.blinks += 1;
    }

    isEyeClosed = false;
    blinkFrames = 0;
    closedSince = null;

    if (inDrowsyState) {
        inDrowsyState = false;
        if (drowsyStart) {
            stats.drowsyMs += now - drowsyStart;
            drowsyStart = null;
        }
        appendLog("Drowsy episode ended");
    }

    stopAlarm();
    setStatus("AWAKE", "awake");
}

function processClosedState(now) {
    if (!isEyeClosed) {
        isEyeClosed = true;
        closedSince = now;
        blinkFrames = 0;
    }

    blinkFrames += 1;

    const closedDuration = now - closedSince;
    if (closedDuration >= ALERT_DELAY_MS) {
        if (!inDrowsyState) {
            inDrowsyState = true;
            stats.drowsyEvents += 1;
            drowsyStart = now;
            appendLog("Drowsy episode detected");
        }

        if (alarmToggle.checked && alarm.paused) {
            alarm.play().catch(() => {
                appendLog("Alarm blocked by browser autoplay policy");
            });
        }

        setStatus("SLEEPY / POSSIBLE DROWSINESS", "sleepy");
    } else {
        setStatus("Eyes closed briefly... monitoring", "pending");
    }
}

const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

faceMesh.onResults((results) => {
    const now = Date.now();

    if (!results.multiFaceLandmarks || !results.multiFaceLandmarks.length) {
        setStatus("No face detected. Please align your face in camera", "pending");
        stopAlarm();
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const leftEAR = eyeAspectRatio(landmarks, LEFT_EYE);
    const rightEAR = eyeAspectRatio(landmarks, RIGHT_EYE);
    const avgEAR = (leftEAR + rightEAR) / 2;

    if (calibrationMode) {
        processCalibration(avgEAR);
        updateStatsUI(avgEAR);
        return;
    }

    if (avgEAR < EYE_THRESHOLD) {
        processClosedState(now);
    } else {
        processAwakeState(now);
    }

    if (!inDrowsyState && drowsyStart) {
        stats.drowsyMs += now - drowsyStart;
        drowsyStart = now;
    }

    updateStatsUI(avgEAR);
});

const camera = new Camera(video, {
    onFrame: async () => {
        await faceMesh.send({ image: video });
    },
    width: 640,
    height: 480
});

camera.start().then(() => {
    setStatus("Camera ready. Start with eyes open for calibration", "pending");
    unlockAudio();
    appendLog("Camera started");
}).catch(() => {
    setStatus("Camera permission denied or unavailable", "sleepy");
    appendLog("Camera start failed");
});