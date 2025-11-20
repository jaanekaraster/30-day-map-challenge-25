// =============================================================
// script.js — integrated final
// =============================================================

// GLOBAL STATE
let countries = [];
let currentCountry = null;
let timeLeft = 10;
let timerDuration = 10;
let score = 0;

let currentTransformType = "Unknown";
let currentProjectionName = "";
let lastTransformFn = null;
let lastTransformMeta = {}; // { type, projectionName?, centroid?, angle? }

let allCountryNames = [];

// SVG / DOM references (assumes those elements exist in your HTML)
const svgWarped = document.getElementById("country-svg");
const modalWarped = document.getElementById("modal-warped");
const modalOriginal = document.getElementById("modal-original");

const projectionLabel = document.getElementById("projection-label");
const modalWarpedLabel = document.getElementById("modal-warped-label");
const modalOriginalLabel = document.getElementById("modal-original-label");

const countryInput = document.getElementById("countryInput");
const guessBtn = document.getElementById("guess-btn");
const timerBox = document.getElementById("timer"); // fallback textual label (kept)
const scoreBox = document.getElementById("score");
const timeSelect = document.getElementById("time-select"); // radio group container not used directly

const modal = document.getElementById("result-modal");
const modalTitle = document.getElementById("modal-title");
const modalDetail = document.getElementById("modal-detail");
const playAgainBtn = document.getElementById("play-again-btn");

// Circular timer UI pieces (must exist in HTML)
const timerNumber = document.getElementById("timer-number");
const timerProgress = document.getElementById("timer-progress");
const timerEmoji = document.getElementById("timer-emoji");

// ring length for radius = 35 (same as CSS)
const RING_LENGTH = 2 * Math.PI * 35;

// =============================================================
// PROJECTIONS & WIKI LINKS
// =============================================================
function wikiLinkForProjection(name) {
    const overrides = {
        "Goode homolosine": "Goode_homolosine_projection",
        "Peirce Quincuncial": "Peirce_quincuncial_projection",
        "Winkel Tripel": "Winkel_tripel_projection",
        "Winkel tripel": "Winkel_tripel_projection",
        "Equal Earth": "Equal_Earth_projection",
        "Dymaxion": "Dymaxion_map",
        "Aitoff": "Aitoff_projection",
        "Hammer": "Hammer_projection",
        "Mollweide": "Mollweide_projection",
        "Sinusoidal": "Sinusoidal_projection",
        "Robinson": "Robinson_projection"
    };

    if (overrides[name]) return "https://en.wikipedia.org/wiki/" + overrides[name];

    // Normalize to a plausible page name
    const clean = name
        .replace(/[–—]/g, "-")
        .replace(/,/g, "")
        .replace(/\s+/g, "_");

    return `https://en.wikipedia.org/wiki/${clean}_projection`;
}

// warpProjections: each item has { name, func(lon,lat) => {x,y}, wiki }
const warpProjections = [
    { name: "Winkel Tripel", func: (lon, lat) => projWarp(lon, lat, "+proj=wintri"), wiki: wikiLinkForProjection("Winkel tripel") },
    // { name: "Equirectangular", func: (lon, lat) => projWarp(lon, lat, "+proj=eqc"), wiki: wikiLinkForProjection("Equirectangular") },
    // { name: "Eckert IV", func: (lon, lat) => projWarp(lon, lat, "+proj=eck4"), wiki: wikiLinkForProjection("Eckert IV") },
    { name: "Eckert VI", func: (lon, lat) => projWarp(lon, lat, "+proj=eck6"), wiki: wikiLinkForProjection("Eckert VI") },
    { name: "Aitoff", func: (lon, lat) => projWarp(lon, lat, "+proj=aitoff"), wiki: wikiLinkForProjection("Aitoff") },
    { name: "Craster Parabolic", func: (lon, lat) => projWarp(lon, lat, "+proj=crast"), wiki: wikiLinkForProjection("Craster parabolic") },
    { name: "Nell-Hammer", func: (lon, lat) => projWarp(lon, lat, "+proj=nell_h"), wiki: wikiLinkForProjection("Hammer") },
    { name: "Homolosine", func: (lon, lat) => projWarp(lon, lat, "+proj=igh"), wiki: wikiLinkForProjection("Goode homolosine") },
    { name: "Foucaut", func: (lon, lat) => projWarp(lon, lat, "+proj=fouc"), wiki: wikiLinkForProjection("Foucaut") },
    { name: "Craig", func: (lon, lat) => projWarp(lon, lat, "+proj=craig"), wiki: wikiLinkForProjection("Craig retroazimuthal") },
    { name: "Peirce Quincuncial", func: (lon, lat) => projWarp(lon, lat, "+proj=peirce_q"), wiki: wikiLinkForProjection("Peirce quincuncial") }
];

// Buckets for biased selection
const equatorDistortions = [
    // "Eckert IV", 
    // "Eckert VI", 
    "Homolosine",
    "Craster Parabolic",
    "Winkel Tripel"
];
const poleDistortions = ["Peirce Quincuncial", "Craig", "Foucaut"];

// Weighted selector by centroid latitude
function pickWarpForLatitude(lat) {
    let filtered;
    if (Math.abs(lat) < 10) {
        if (Math.random() < 0.6) {
            filtered = warpProjections.filter(p => equatorDistortions.includes(p.name));
        } else filtered = warpProjections;
    } else if (Math.abs(lat) > 50) {
        if (Math.random() < 0.6) {
            filtered = warpProjections.filter(p => poleDistortions.includes(p.name));
        } else filtered = warpProjections;
    } else {
        filtered = warpProjections;
    }
    return filtered[Math.floor(Math.random() * filtered.length)];
}

// =============================================================
// LOADING / CLEANING COUNTRIES
// =============================================================
async function loadCountries() {
    try {
        const res = await fetch("custom_lg.geo.json");
        const data = await res.json();
        countries = cleanCountryList(data.features);
        allCountryNames = countries.map(f => f.properties.name);
        populateCountryList(allCountryNames);
        startNewRound();
    } catch (err) {
        console.error("Failed to load countries:", err);
    }
}

function cleanCountryList(countriesList) {
    return countriesList.filter(c => {
        const name = c.properties && c.properties.name ? c.properties.name : "";
        const bannedExact = ["Gibraltar", "Bajo Nuevo Bank","Akrotiri", "Baikonur", "Dhekelia","Cyprus U.N. Buffer Zone"];
        if (bannedExact.includes(name)) return false;
        if (name.includes("Is.")) return false;
        if (name.includes("Ter.")) return false;
        return true;
    });
}

const input = document.getElementById("countryInput");
const dropdown = document.getElementById("countryDropdown");

// your filtered list
let validCountries = []; // replace with your filtered country list

function populateCountryList(countryNames) {
    validCountries = [...countryNames].sort((a,b) => a.localeCompare(b, 'en', {sensitivity:'base'}));
}

input.addEventListener("input", () => {
    const value = input.value.toLowerCase();
    dropdown.innerHTML = "";

    if (!value) {
        dropdown.classList.add("hidden");
        return;
    }

    const matches = validCountries.filter(c =>
        c.toLowerCase().includes(value)
    );

    if (matches.length === 0) {
        dropdown.classList.add("hidden");
        return;
    }

    matches.forEach(name => {
        const item = document.createElement("div");
        item.textContent = name;
        item.addEventListener("click", () => {
            if (countryInput) countryInput.value = name;
            input.value = name; // keep search box in sync
            dropdown.classList.add("hidden");
        });
        dropdown.appendChild(item);
    });

    dropdown.classList.remove("hidden");
});

// hide dropdown when clicking elsewhere
document.addEventListener("click", (e) => {
    if (!input || !dropdown) return;
    if (e.target === input || input.contains(e.target) || dropdown.contains(e.target)) return;
    dropdown.classList.add("hidden");
});


// =============================================================
// CIRCULAR TIMER (visual)
// =============================================================
let visualTimerInterval = null;

function startTimer(seconds) {
    // lock difficulty radios while running
    setDifficultyRadiosDisabled(true);

    clearInterval(visualTimerInterval);
    timerDuration = seconds;
    timeLeft = seconds;
    updateTimerVisual();

    visualTimerInterval = setInterval(() => {
        timeLeft--;
        updateTimerVisual();

        if (timeLeft <= 0) {
            clearInterval(visualTimerInterval);
            handleTimeExpired();
        }
    }, 1000);
}

function updateTimerVisual() {
    if (timerNumber) timerNumber.innerText = timeLeft;
    const fraction = timeLeft / Math.max(1, timerDuration);
    if (timerProgress) timerProgress.style.strokeDashoffset = RING_LENGTH * (1 - fraction);

    if (fraction > 0.5) {
        if (timerProgress) timerProgress.style.stroke = "#28a745";
        if (timerEmoji) timerEmoji.innerText = "⏳";
    } else if (fraction > 0.25) {
        if (timerProgress) timerProgress.style.stroke = "#ffc107";
        if (timerEmoji) timerEmoji.innerText = "⚠️";
    } else {
        if (timerProgress) timerProgress.style.stroke = "#dc3545";
        if (timerEmoji) timerEmoji.innerText = "⏰";
    }

    // Also update textual fallback
    if (timerBox) timerBox.innerText = `⏱️ Time: ${timeLeft}s`;
}

function handleTimeExpired() {
    // End round (incorrect)
    revealResult(false);
}

// Difficulty radio helpers
function setDifficultyRadiosDisabled(disabled) {
    const radios = document.querySelectorAll("input[name='difficulty']");
    radios.forEach(r => (r.disabled = disabled));
}

// =============================================================
// START ROUND
// =============================================================
function startNewRound() {
    document.getElementById("difficulty-container").style.display = "none";

    // hide modal if open
    if (modal) modal.style.display = "none";

    // clear input and focus
    if (countryInput) {
        countryInput.value = "";
        countryInput.focus();
    }

    // Read selected difficulty and lock it
    const difficultyEl = document.querySelector("input[name='difficulty']:checked");
    const seconds = difficultyEl ? parseInt(difficultyEl.value, 10) : 10;
    timerDuration = seconds;
    timeLeft = seconds;

    if (!countries || countries.length === 0) {
        console.warn("No countries loaded.");
        return;
    }

    currentCountry = countries[Math.floor(Math.random() * countries.length)];

    // === ALWAYS pick a projection ===
    const centroid = getCentroid(currentCountry.geometry);
    const proj = pickWarpForLatitude(centroid.y);
    currentProjectionName = proj.name;
    const projectionFn = (pt) => {
        try {
            return proj.func(pt.x, pt.y);
        } catch {
            return { x: pt.x, y: pt.y };
        }
    };

    // === Choose a secondary transform ===
    const secondaryChoice = Math.random() < 0.5 ? "Random Rotation" : "Rotate and Mirror";
    currentTransformType = secondaryChoice;

    let secondaryFn;
    if (secondaryChoice === "Random Rotation") {
        const angle = Math.random() * 360 - 180;
        secondaryFn = (pt) => randomRotate(pt, angle, centroid);
        lastTransformMeta = { type: secondaryChoice, centroid, angle, projectionName: currentProjectionName };
    } else {
        const angle = Math.random() * 360 - 180;
        secondaryFn = (pt) => rotateAndMirror(pt, angle, centroid);
        lastTransformMeta = { type: secondaryChoice, centroid, angle, projectionName: currentProjectionName };
    }

    // === Compose final transform: projection → secondary ===
    lastTransformFn = (pt) => secondaryFn(projectionFn(pt));

    // Draw main warped image
    drawSVG(svgWarped, currentCountry.geometry, lastTransformFn);

    // Update label
    if (projectionLabel) {
        projectionLabel.innerHTML = `${currentProjectionName} projection applied (${secondaryChoice})`;
    }

    // Add wiki link on main screen and modal
    const projectionInfoMain = document.getElementById("projection-info");
    const projectionInfoModal = document.getElementById("projection-info-modal");

    projectionInfoMain.innerHTML = "";
    projectionInfoModal.innerHTML = "";

    if (currentProjectionName) {
        const projObj = warpProjections.find(p => p.name === currentProjectionName);
        if (projObj && projObj.wiki) {
            const link = document.createElement("a");
            link.href = projObj.wiki;
            link.target = "_blank";
            link.rel = "noopener";
            link.innerText = "Learn more about this projection";
            link.style.fontSize = "0.9em";
            link.style.marginBottom = "0.5em";

            const linkModal = link.cloneNode(true);

            projectionInfoMain.appendChild(link);
            projectionInfoModal.appendChild(linkModal);
        }
    }

    // Start visual timer (locks radios inside)
    startTimer(seconds);
}


// =============================================================
// GUESS handling
// =============================================================
if (guessBtn) guessBtn.addEventListener("click", () => submitGuess());
if (countryInput) {
    countryInput.addEventListener("keydown", e => {
        if (e.key === "Enter") submitGuess();
    });
}

document.getElementById("shareButton").addEventListener("click", async () => {
    const shareUrl = "https://mylink.com/?ref=countrygame";

    if (navigator.share) {
        // Mobile + modern browsers
        try {
            await navigator.share({
                title: "Guess The Country!",
                text: "Try this country guessing game!",
                url: shareUrl
            });
        } catch (err) {
            console.log("Share cancelled", err);
        }
    } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(shareUrl);
        alert("Link copied!");
    }
});



function submitGuess() {
    if (!currentCountry) return;
    // Stop the visual timer
    clearInterval(visualTimerInterval);
    setDifficultyRadiosDisabled(false);

    const guess = (countryInput.value || "").trim().toLowerCase();
    console.log(guess);
    const answer = (currentCountry.properties && currentCountry.properties.name || "").toLowerCase();

    const correct = guess === answer;
    if (correct) score++;
    scoreBox.innerText = `Score: ${score}`;

    revealResult(correct);
}

// =============================================================
// REVEAL RESULT (modal)
// =============================================================
function revealResult(correct) {
    modal.style.display = "block";
    document.getElementById("difficulty-container").style.display = "block";
    document.getElementById("modal-score").innerText = `Your current score: ${score}`;

    // stop timer
    clearInterval(visualTimerInterval);
    setDifficultyRadiosDisabled(false);

    modalTitle.innerText = correct ? "✅ Correct!" : "❌ Incorrect!";
    modalDetail.innerText = `The country was: ${currentCountry.properties.name}`;

    // clear modal slots
    modalWarped.innerHTML = "";
    modalOriginal.innerHTML = "";

    modalWarpedLabel.innerText = currentTransformType + (currentProjectionName ? `: ${currentProjectionName}` : "");
    modalOriginalLabel.innerText = "Original Projection: EPSG:4326";

    // create svg containers
    const warpedSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    warpedSVG.setAttribute("viewBox", "0 0 1000 1000");
    warpedSVG.setAttribute("width", "100%");
    warpedSVG.setAttribute("height", "100%");
    modalWarped.appendChild(warpedSVG);

    const originalSVG = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    originalSVG.setAttribute("viewBox", "0 0 1000 1000");
    originalSVG.setAttribute("width", "100%");
    originalSVG.setAttribute("height", "100%");
    modalOriginal.appendChild(originalSVG);

    // Draw warped with same transform used during the round
    if (typeof lastTransformFn === "function") {
        drawSVG(warpedSVG, currentCountry.geometry, lastTransformFn);
    } else {
        drawSVG(warpedSVG, currentCountry.geometry, (pt) => ({ x: pt.x, y: pt.y }));
    }

    // Draw original identity
    drawSVG(originalSVG, currentCountry.geometry, (pt) => ({ x: pt.x, y: pt.y }));

    // show modal (keeps open until Play Again)
    modal.style.display = "flex";
}

// Play again
if (playAgainBtn) playAgainBtn.addEventListener("click", () => {
    // hide modal and start new round
    if (modal) modal.style.display = "none";
    startNewRound();
});

// =============================================================
// PROJ4 wrapper
// =============================================================
function projWarp(lon, lat, projDef) {
    try {
        const p = proj4("EPSG:4326", projDef, [lon, lat]);
        return { x: p[0], y: p[1] };
    } catch (err) {
        return { x: lon, y: lat };
    }
}

// =============================================================
// TRANSFORMS
// =============================================================
function randomRotate(point, angleDeg, centroid) {
    const angle = angleDeg * (Math.PI / 180);
    const x = point.x - centroid.x;
    const y = point.y - centroid.y;
    const xr = x * Math.cos(angle) - y * Math.sin(angle);
    const yr = x * Math.sin(angle) + y * Math.cos(angle);
    return { x: xr + centroid.x, y: yr + centroid.y };
}

function rotateAndMirror(point, angleDeg, centroid) {
    const angle = angleDeg * (Math.PI / 180);
    let x = point.x - centroid.x;
    let y = point.y - centroid.y;
    const xr = x * Math.cos(angle) - y * Math.sin(angle);
    const yr = x * Math.sin(angle) + y * Math.cos(angle);
    const xm = -xr;
    return { x: xm + centroid.x, y: yr + centroid.y };
}

// (randomWarp intentionally not used because it created spider webs)

// =============================================================
// Geometry helpers
// =============================================================
function extractAllRings(geom) {
    const rings = [];
    if (!geom) return rings;
    if (geom.type === "Polygon") {
        geom.coordinates.forEach(r => rings.push(r));
    } else if (geom.type === "MultiPolygon") {
        geom.coordinates.forEach(poly => poly.forEach(ring => rings.push(ring)));
    }
    return rings;
}

function getCentroid(geom) {
    const rings = extractAllRings(geom);
    const flat = rings.flat();
    if (!flat || flat.length === 0) return { x: 0, y: 0 };
    const xs = flat.map(p => p[0]);
    const ys = flat.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    return { x: cx, y: cy };
}

// =============================================================
// DRAW onto an SVG (preserves separate rings)
// - centers geometry centroid at (500,500)
// - scales so largest dimension == 80% of 1000 (i.e. 800px)
// - transformFn accepts object {x,y} and returns {x,y}
// =============================================================
function drawSVG(svgElem, geometry, transformFn) {
    if (!svgElem) return;
    svgElem.innerHTML = "";

    let strokeColor = "#000";
    let fillColor = "#ccc";

    // Assign colors based on WHERE it's being drawn
    if (svgElem.id === "svgWarpedModal") {
        strokeColor = "red";
        fillColor = "rgba(255,0,0,0.3)";
    } else if (svgElem.id === "svgOriginalModal") {
        strokeColor = "blue";
        fillColor = "rgba(0,0,255,0.3)";
    }

    const rings = extractAllRings(geometry);
    if (!rings.length) return;

    const projected = rings.map(ring =>
        ring.map(([lon, lat]) => {
            try {
                const p = transformFn({ x: lon, y: lat });
                if (!p || !isFinite(p.x) || !isFinite(p.y)) return null;
                return { x: p.x, y: p.y };
            } catch {
                return null;
            }
        }).filter(Boolean)
    ).filter(r => r.length >= 3);

    if (!projected.length) return;

    const flat = projected.flat();
    const xs = flat.map(p => p.x);
    const ys = flat.map(p => p.y);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const width = maxX - minX;
    const height = maxY - minY;
    const maxDim = Math.max(width, height, 1e-6);

    const TARGET_FRAC = 0.80;
    const TARGET_PX = 1000 * TARGET_FRAC;
    const scale = TARGET_PX / maxDim;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const svgCenterX = 500;
    const svgCenterY = 500;

    const offsetX = svgCenterX - centerX * scale;
    const offsetY = svgCenterY + centerY * scale;

    projected.forEach(ring => {
        if (ring.length < 3) return;
        const pts = ring.map(p =>
            `${(p.x * scale + offsetX).toFixed(2)},${(-p.y * scale + offsetY).toFixed(2)}`
        ).join(" ");

        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", pts);

        // ✔️ NOW use your computed colors
        poly.setAttribute("fill", fillColor);
        poly.setAttribute("stroke", strokeColor);

        poly.setAttribute("stroke-width", "1.5");
        svgElem.appendChild(poly);
    });
}


// =============================================================
// BOOT
// =============================================================
window.addEventListener("load", () => {
    // Populate difficulty radio listeners that lock at round start (if any)
    const radios = document.querySelectorAll("input[name='difficulty']");
    radios.forEach(r => r.addEventListener("change", () => {
        // update timerDuration only if not locked
        const selected = document.querySelector("input[name='difficulty']:checked");
        if (selected && !selected.disabled) {
            timerDuration = parseInt(selected.value, 10);
        }
    }));

    // Load country data and start
    loadCountries();
});
