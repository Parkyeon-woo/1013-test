/* ========================================================
   TOEIC VOCA MASTER - APP LOGIC
   Complete Interactive Engine & State Management
======================================================== */

// 상태 저장소 및 로컬스토리지 키
const STORAGE_KEY = "TOEIC_VOCA_STATE_V1";

// 기본 상태 구조
const defaultState = {
  theme: "dark",
  soundEnabled: true,
  streak: 1,
  lastVisitDate: new Date().toDateString(),
  todayCount: 0,
  xp: 0,
  masteredIds: [],
  reviewIds: [],
  bookmarkIds: [],
  customWords: []
};

// 현재 런타임 상태
let state = { ...defaultState };

// 데이터 로드
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      state = { ...defaultState, ...parsed };
      
      // 날짜 확인하여 당일 학습량 및 연속 출석 체크
      const today = new Date().toDateString();
      if (state.lastVisitDate !== today) {
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        if (state.lastVisitDate === yesterday) {
          state.streak += 1;
        } else {
          state.streak = 1;
        }
        state.todayCount = 0;
        state.lastVisitDate = today;
      }
    }
  } catch (e) {
    console.warn("Storage load error:", e);
  }
}

// 상태 저장
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("Storage save error:", e);
  }
}

// 전체 단어 결합 (기본 단어 + 사용자 추가 단어)
function getAllWords() {
  return [...TOEIC_WORDS, ...(state.customWords || [])];
}

// --------------------------------------------------------
// 오디오 시스템 (Web Audio API 신디사이저)
// --------------------------------------------------------
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

const SoundFX = {
  click() {
    if (!state.soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  },
  success() {
    if (!state.soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + idx * 0.06);
      gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.25);
    });
  },
  wrong() {
    if (!state.soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(130, now + 0.18);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.18);
  },
  levelup() {
    if (!state.soundEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }
};

// Web Speech API (TTS) 발음 재생
function speakWord(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

// --------------------------------------------------------
// 경험치 & 레벨 시스템
// --------------------------------------------------------
const LEVELS = [
  { lv: 1, title: "토익 입문 (Lv.1)", req: 0 },
  { lv: 2, title: "스타터 600 (Lv.2)", req: 100 },
  { lv: 3, title: "주니어 700 (Lv.3)", req: 300 },
  { lv: 4, title: "중급 도약 750 (Lv.4)", req: 600 },
  { lv: 5, title: "어휘 마스터 800 (Lv.5)", req: 1000 },
  { lv: 6, title: "실전 고득점 850 (Lv.6)", req: 1500 },
  { lv: 7, title: "토익 킬러 900 (Lv.7)", req: 2200 },
  { lv: 8, title: "RC/LC 950 (Lv.8)", req: 3000 },
  { lv: 9, title: "만점 보증 980 (Lv.9)", req: 4000 },
  { lv: 10, title: "990 만점 제왕 (Lv.10)", req: 5500 }
];

function addXp(amount) {
  const prevLevel = getCurrentLevel();
  state.xp += amount;
  state.todayCount += 1;
  const newLevel = getCurrentLevel();
  
  if (newLevel.lv > prevLevel.lv) {
    SoundFX.levelup();
    triggerConfetti();
    alert(`🎉 축하합니다! 레벨 업: ${newLevel.title}`);
  }
  saveState();
  updateStatsUI();
}

function getCurrentLevel() {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (state.xp >= LEVELS[i].req) {
      return { ...LEVELS[i], nextReq: LEVELS[i + 1] ? LEVELS[i + 1].req : LEVELS[i].req * 1.5 };
    }
  }
  return { ...LEVELS[0], nextReq: 100 };
}

function updateStatsUI() {
  document.getElementById("statStreak").textContent = state.streak;
  document.getElementById("statToday").textContent = state.todayCount;
  
  const curLv = getCurrentLevel();
  document.getElementById("statLevel").textContent = curLv.title;
  
  const curTierMin = curLv.req;
  const nextTierMin = curLv.nextReq;
  const progressPercent = Math.min(100, Math.max(5, ((state.xp - curTierMin) / (nextTierMin - curTierMin)) * 100));
  document.getElementById("statXpBar").style.width = `${progressPercent}%`;

  document.getElementById("bookmarkCount").textContent = state.bookmarkIds.length;
  document.getElementById("reviewCount").textContent = state.reviewIds.length;
}

// --------------------------------------------------------
// 필터 & 정렬 시스템
// --------------------------------------------------------
let currentFilterLevel = "all";
let currentSearchQuery = "";
let currentFilteredWords = [];

function applyFilters() {
  const allWords = getAllWords();
  
  currentFilteredWords = allWords.filter(item => {
    // 1. 레벨 필터
    if (currentFilterLevel === "bookmark") {
      if (!state.bookmarkIds.includes(item.id)) return false;
    } else if (currentFilterLevel === "review") {
      if (!state.reviewIds.includes(item.id)) return false;
    } else if (currentFilterLevel !== "all") {
      if (item.level !== currentFilterLevel) return false;
    }

    // 2. 검색어 필터
    if (currentSearchQuery.trim() !== "") {
      const q = currentSearchQuery.toLowerCase();
      const matchWord = item.word.toLowerCase().includes(q);
      const matchMeaning = item.meaning.toLowerCase().includes(q);
      const matchCategory = item.category ? item.category.toLowerCase().includes(q) : false;
      if (!matchWord && !matchMeaning && !matchCategory) return false;
    }

    return true;
  });

  if (currentFilteredWords.length === 0) {
    // 필터 결과가 없을 때 대체용 안내 단어 1개
    currentFilteredWords = [{
      id: -1,
      word: "No Words Found",
      phonetic: "/-/",
      partOfSpeech: "-",
      meaning: "해당 조건의 단어가 없습니다. 필터를 변경해 보세요.",
      exampleEn: "Try changing filter settings or search terms.",
      exampleKo: "필터 설정을 변경하거나 검색어를 비워주세요.",
      collocation: "-",
      synonyms: "-",
      level: "750",
      category: "안내"
    }];
  }

  // 각 모드 새로고침
  updateFlashcardUI();
  renderVocabGrid();
}

// --------------------------------------------------------
// 1. 플래시카드 로직
// --------------------------------------------------------
let cardCurrentIndex = 0;
let autoPlayTimer = null;

const flashcardEl = document.getElementById("flashcard");
const cardWordEl = document.getElementById("cardWord");
const cardPosEl = document.getElementById("cardPos");
const cardPhoneticEl = document.getElementById("cardPhonetic");
const cardLevelEl = document.getElementById("cardLevel");
const cardCategoryEl = document.getElementById("cardCategory");
const cardMeaningEl = document.getElementById("cardMeaning");
const cardExampleEnEl = document.getElementById("cardExampleEn");
const cardExampleKoEl = document.getElementById("cardExampleKo");
const cardCollocationEl = document.getElementById("cardCollocation");
const cardSynonymsEl = document.getElementById("cardSynonyms");
const cardCurrentIdxEl = document.getElementById("cardCurrentIdx");
const cardTotalCountEl = document.getElementById("cardTotalCount");
const cardProgressFill = document.getElementById("cardProgressFill");
const cardBookmarkBtnFront = document.getElementById("cardBookmarkBtn");
const cardBookmarkBtnBack = document.getElementById("cardBookmarkBtnBack");

function updateFlashcardUI() {
  if (cardCurrentIndex >= currentFilteredWords.length) {
    cardCurrentIndex = 0;
  }
  if (cardCurrentIndex < 0) {
    cardCurrentIndex = currentFilteredWords.length - 1;
  }

  const word = currentFilteredWords[cardCurrentIndex];
  if (!word) return;

  // 카드 앞면 회전 상태 초기화
  flashcardEl.classList.remove("flipped");

  // 내용 채우기
  cardWordEl.textContent = word.word;
  cardPosEl.textContent = word.partOfSpeech || "";
  cardPhoneticEl.textContent = word.phonetic || "";
  cardLevelEl.textContent = `TARGET ${word.level || 750}+`;
  cardCategoryEl.textContent = word.category || "비즈니스";

  cardMeaningEl.textContent = word.meaning;
  cardExampleEnEl.textContent = word.exampleEn || "";
  cardExampleKoEl.textContent = word.exampleKo || "";
  cardCollocationEl.textContent = word.collocation || "-";
  cardSynonymsEl.textContent = word.synonyms || "-";

  // 북마크 활성 상태
  const isBookmarked = state.bookmarkIds.includes(word.id);
  cardBookmarkBtnFront.classList.toggle("active", isBookmarked);
  cardBookmarkBtnBack.classList.toggle("active", isBookmarked);

  // 진행도 표시
  cardCurrentIdxEl.textContent = cardCurrentIndex + 1;
  cardTotalCountEl.textContent = currentFilteredWords.length;
  const pct = ((cardCurrentIndex + 1) / currentFilteredWords.length) * 100;
  cardProgressFill.style.width = `${pct}%`;
}

function flipCard() {
  SoundFX.click();
  flashcardEl.classList.toggle("flipped");
}

function nextCard() {
  SoundFX.click();
  cardCurrentIndex = (cardCurrentIndex + 1) % currentFilteredWords.length;
  updateFlashcardUI();
}

function prevCard() {
  SoundFX.click();
  cardCurrentIndex = (cardCurrentIndex - 1 + currentFilteredWords.length) % currentFilteredWords.length;
  updateFlashcardUI();
}

function markCardMastered() {
  const currentWord = currentFilteredWords[cardCurrentIndex];
  if (!currentWord || currentWord.id < 0) return;

  SoundFX.success();
  if (!state.masteredIds.includes(currentWord.id)) {
    state.masteredIds.push(currentWord.id);
  }
  // 오답노트에 있었다면 제거
  state.reviewIds = state.reviewIds.filter(id => id !== currentWord.id);
  addXp(15);
  nextCard();
}

function markCardReview() {
  const currentWord = currentFilteredWords[cardCurrentIndex];
  if (!currentWord || currentWord.id < 0) return;

  SoundFX.wrong();
  if (!state.reviewIds.includes(currentWord.id)) {
    state.reviewIds.push(currentWord.id);
    saveState();
    updateStatsUI();
  }
  nextCard();
}

function toggleBookmarkCurrentWord() {
  const currentWord = currentFilteredWords[cardCurrentIndex];
  if (!currentWord || currentWord.id < 0) return;

  const idx = state.bookmarkIds.indexOf(currentWord.id);
  if (idx === -1) {
    state.bookmarkIds.push(currentWord.id);
  } else {
    state.bookmarkIds.splice(idx, 1);
  }
  SoundFX.click();
  saveState();
  updateStatsUI();
  updateFlashcardUI();
  renderVocabGrid();
}

// 자동 재생 모드 토글
function toggleAutoPlay() {
  const icon = document.getElementById("autoPlayIcon");
  const text = document.getElementById("autoPlayText");
  const btn = document.getElementById("autoPlayBtn");

  if (autoPlayTimer) {
    clearInterval(autoPlayTimer);
    autoPlayTimer = null;
    icon.textContent = "▶";
    text.textContent = "자동재생";
    btn.classList.remove("active");
  } else {
    icon.textContent = "⏸";
    text.textContent = "정지";
    btn.classList.add("active");

    autoPlayTimer = setInterval(() => {
      if (!flashcardEl.classList.contains("flipped")) {
        flipCard();
      } else {
        nextCard();
      }
    }, 3200);
  }
}

// --------------------------------------------------------
// 2. 4지선다 퀴즈 로직
// --------------------------------------------------------
let quizPool = [];
let quizIndex = 0;
let quizScore = 0;
let quizCombo = 0;
let quizWrongIds = [];
const QUIZ_SIZE = 10;

function startQuiz(customWordList = null) {
  const words = customWordList || (currentFilteredWords.filter(w => w.id > 0).length > 4 ? currentFilteredWords.filter(w => w.id > 0) : getAllWords());
  quizPool = [...words].sort(() => 0.5 - Math.random()).slice(0, QUIZ_SIZE);
  quizIndex = 0;
  quizScore = 0;
  quizCombo = 0;
  quizWrongIds = [];

  document.getElementById("quizResultCard").style.display = "none";
  document.querySelector(".quiz-container").style.display = "block";
  document.getElementById("quizTotalNo").textContent = quizPool.length;
  renderQuizQuestion();
}

function renderQuizQuestion() {
  if (quizIndex >= quizPool.length) {
    showQuizResult();
    return;
  }

  const currentQ = quizPool[quizIndex];
  document.getElementById("quizCurrentNo").textContent = quizIndex + 1;
  document.getElementById("quizScoreText").textContent = quizScore;
  document.getElementById("quizQuestionWord").textContent = currentQ.word;
  document.getElementById("quizWordPos").textContent = currentQ.partOfSpeech || "v.";
  document.getElementById("quizFeedbackBox").style.display = "none";

  // 콤보 표시
  const comboEl = document.getElementById("quizComboBadge");
  if (quizCombo >= 2) {
    comboEl.style.display = "inline-block";
    document.getElementById("quizComboCount").textContent = quizCombo;
  } else {
    comboEl.style.display = "none";
  }

  // 4개 선택지 준비 (정답 1개 + 오답 3개 무작위)
  const all = getAllWords();
  const distractors = all
    .filter(w => w.id !== currentQ.id)
    .sort(() => 0.5 - Math.random())
    .slice(0, 3);
  
  const options = [currentQ, ...distractors].sort(() => 0.5 - Math.random());

  const optionsGrid = document.getElementById("quizOptionsGrid");
  optionsGrid.innerHTML = "";

  options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option-btn";
    btn.innerHTML = `<span class="option-num">${idx + 1}</span> ${opt.meaning}`;
    btn.onclick = () => handleQuizAnswer(opt.id === currentQ.id, btn, currentQ);
    optionsGrid.appendChild(btn);
  });
}

function handleQuizAnswer(isCorrect, selectedBtn, questionWord) {
  const allOptionBtns = document.querySelectorAll(".quiz-option-btn");
  allOptionBtns.forEach(btn => btn.disabled = true);

  const feedbackBox = document.getElementById("quizFeedbackBox");
  const feedbackTitle = document.getElementById("quizFeedbackTitle");
  const feedbackExample = document.getElementById("quizFeedbackExample");

  if (isCorrect) {
    selectedBtn.classList.add("correct");
    SoundFX.success();
    quizCombo++;
    const bonus = quizCombo >= 3 ? 15 : 10;
    quizScore += bonus;
    addXp(12);

    feedbackTitle.innerHTML = `정답입니다! 🎉 (+${bonus}점)`;
    feedbackTitle.style.color = "#34d399";
  } else {
    selectedBtn.classList.add("wrong");
    SoundFX.wrong();
    quizCombo = 0;
    quizWrongIds.push(questionWord.id);
    if (!state.reviewIds.includes(questionWord.id)) {
      state.reviewIds.push(questionWord.id);
      saveState();
      updateStatsUI();
    }

    feedbackTitle.innerHTML = `아쉽습니다! 정답을 확인하세요. 💡`;
    feedbackTitle.style.color = "#f87171";

    // 실제 정답 버튼에 하이라이트
    allOptionBtns.forEach(btn => {
      if (btn.textContent.includes(questionWord.meaning)) {
        btn.classList.add("correct");
      }
    });
  }

  feedbackExample.textContent = `💡 예문: "${questionWord.exampleEn}" (${questionWord.exampleKo})`;
  feedbackBox.style.display = "block";
}

function showQuizResult() {
  document.querySelector(".quiz-container").style.display = "none";
  const resultCard = document.getElementById("quizResultCard");
  resultCard.style.display = "block";

  const total = quizPool.length;
  const correctCount = total - quizWrongIds.length;
  document.getElementById("finalScoreVal").textContent = quizScore;
  document.getElementById("finalCorrectCount").textContent = correctCount;
  document.getElementById("finalTotalCount").textContent = total;

  const commentEl = document.getElementById("finalComment");
  if (correctCount === total) {
    commentEl.textContent = "🏆 퍼펙트! 실전 토익 990점 만점 페이스입니다!";
    triggerConfetti();
    SoundFX.levelup();
  } else if (correctCount >= total * 0.7) {
    commentEl.textContent = "✨ 훌륭한 실력입니다! 오답 단어만 한 번 더 짚고 넘어가세요.";
  } else {
    commentEl.textContent = "💪 기본기가 잡혀가는 중입니다. 오답 복습으로 완벽하게 다져보세요!";
  }
}

// --------------------------------------------------------
// 3. 타이핑 훈련 로직
// --------------------------------------------------------
let typingIndex = 0;
let typingDone = 0;

function updateTypingUI() {
  const words = currentFilteredWords.filter(w => w.id > 0);
  if (words.length === 0) return;
  if (typingIndex >= words.length) typingIndex = 0;

  const word = words[typingIndex];
  document.getElementById("typingCurrentNo").textContent = typingIndex + 1;
  document.getElementById("typingTotalNo").textContent = words.length;
  document.getElementById("typingDoneCount").textContent = typingDone;
  document.getElementById("typingCategory").textContent = word.category || "비즈니스";
  document.getElementById("typingMeaning").textContent = word.meaning;

  // 예문에서 단어 마스킹
  const regex = new RegExp(word.word, "gi");
  const sentence = word.exampleEn ? word.exampleEn.replace(regex, `<span class="blank-target">${"_ ".repeat(word.word.length)}</span>`) : "";
  document.getElementById("typingSentence").innerHTML = sentence;

  const input = document.getElementById("typingInput");
  input.value = "";
  input.focus();
  document.getElementById("typingHintText").style.display = "none";
  document.getElementById("typingFeedback").style.display = "none";
}

function checkTypingAnswer() {
  const words = currentFilteredWords.filter(w => w.id > 0);
  const currentWord = words[typingIndex];
  if (!currentWord) return;

  const inputVal = document.getElementById("typingInput").value.trim().toLowerCase();
  const targetVal = currentWord.word.toLowerCase();
  const feedback = document.getElementById("typingFeedback");
  const feedbackText = document.getElementById("typingFeedbackText");

  if (inputVal === targetVal) {
    SoundFX.success();
    typingDone++;
    addXp(15);
    feedbackText.innerHTML = `정답! <strong>${currentWord.word}</strong> (/ ${currentWord.phonetic} /)`;
    feedbackText.style.color = "#34d399";
    feedback.style.display = "flex";
  } else {
    SoundFX.wrong();
    feedbackText.innerHTML = `철자를 다시 확인해보세요! (정답: <strong>${currentWord.word}</strong>)`;
    feedbackText.style.color = "#f87171";
    feedback.style.display = "flex";
  }
}

function showTypingHint() {
  const words = currentFilteredWords.filter(w => w.id > 0);
  const word = words[typingIndex];
  if (!word) return;
  const hintText = document.getElementById("typingHintText");
  hintText.textContent = `${word.word[0]}... (총 ${word.word.length}글자)`;
  hintText.style.display = "inline";
}

// --------------------------------------------------------
// 4. 단어장 그리드 렌더링
// --------------------------------------------------------
function renderVocabGrid() {
  const grid = document.getElementById("vocabGrid");
  const sortType = document.getElementById("listSortSelect").value;
  grid.innerHTML = "";

  let list = [...currentFilteredWords].filter(w => w.id > 0);

  if (sortType === "alpha-asc") {
    list.sort((a, b) => a.word.localeCompare(b.word));
  } else if (sortType === "level-asc") {
    list.sort((a, b) => Number(a.level) - Number(b.level));
  } else if (sortType === "level-desc") {
    list.sort((a, b) => Number(b.level) - Number(a.level));
  } else {
    list.sort((a, b) => a.id - b.id);
  }

  document.getElementById("listWordCount").textContent = list.length;

  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">표시할 단어가 없습니다.</div>`;
    return;
  }

  list.forEach(item => {
    const isMastered = state.masteredIds.includes(item.id);
    const isReview = state.reviewIds.includes(item.id);
    const isBookmarked = state.bookmarkIds.includes(item.id);

    let badgeClass = "learning";
    let badgeText = "학습 중";
    if (isMastered) {
      badgeClass = "mastered";
      badgeText = "외움 완료";
    } else if (isReview) {
      badgeClass = "review";
      badgeText = "복습 필요";
    }

    const card = document.createElement("div");
    card.className = "vocab-card";
    card.innerHTML = `
      <div class="vocab-card-header">
        <div class="card-title-group">
          <h4 class="vocab-title">${item.word}</h4>
          <span class="vocab-pos-tag">${item.partOfSpeech || ""}</span>
        </div>
        <div class="vocab-card-actions">
          <button class="mini-icon-btn list-tts-btn" title="발음 듣기">🔊</button>
          <button class="mini-icon-btn list-star-btn ${isBookmarked ? 'active' : ''}" title="즐겨찾기">★</button>
        </div>
      </div>
      <div class="vocab-phonetic-text">${item.phonetic || ""}</div>
      <div class="vocab-meaning-text">${item.meaning}</div>
      <div class="vocab-example-en">${item.exampleEn || ""}</div>
      <div class="vocab-card-footer">
        <span class="badge-level">RC/LC ${item.level}+</span>
        <span class="status-badge ${badgeClass}">${badgeText}</span>
      </div>
    `;

    card.querySelector(".list-tts-btn").onclick = (e) => {
      e.stopPropagation();
      speakWord(item.word);
    };

    card.querySelector(".list-star-btn").onclick = (e) => {
      e.stopPropagation();
      const idx = state.bookmarkIds.indexOf(item.id);
      if (idx === -1) state.bookmarkIds.push(item.id);
      else state.bookmarkIds.splice(idx, 1);
      saveState();
      updateStatsUI();
      renderVocabGrid();
    };

    grid.appendChild(card);
  });
}

// --------------------------------------------------------
// 캔버스 컨페티(축하 효과) 애니메이션
// --------------------------------------------------------
function triggerConfetti() {
  const canvas = document.getElementById("confettiCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ["#6366f1", "#ec4899", "#06b6d4", "#f59e0b", "#10b981", "#ffffff"];

  for (let i = 0; i < 90; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.8) * 18,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      rotation: Math.random() * 360,
      vRot: (Math.random() - 0.5) * 10
    });
  }

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.4; // gravity
      p.rotation += p.vRot;
      p.alpha -= 0.012;

      if (p.alpha > 0) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    });

    if (alive) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(frame);
}

// --------------------------------------------------------
// 이벤트 리스너 바인딩
// --------------------------------------------------------
function initEventListeners() {
  // 테마 토글
  document.getElementById("themeToggleBtn").onclick = () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.body.setAttribute("data-theme", state.theme);
    document.getElementById("themeIcon").textContent = state.theme === "dark" ? "🌙" : "☀️";
    saveState();
  };

  // 사운드 토글
  document.getElementById("soundToggleBtn").onclick = () => {
    state.soundEnabled = !state.soundEnabled;
    document.getElementById("soundIcon").textContent = state.soundEnabled ? "🔊" : "🔇";
    saveState();
  };

  // 상단 레벨 탭 클릭
  document.querySelectorAll(".level-tab").forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll(".level-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilterLevel = tab.getAttribute("data-level");
      cardCurrentIndex = 0;
      applyFilters();
    };
  });

  // 검색 인풋
  const searchInput = document.getElementById("searchInput");
  const searchClearBtn = document.getElementById("searchClearBtn");

  searchInput.oninput = () => {
    currentSearchQuery = searchInput.value;
    searchClearBtn.style.display = currentSearchQuery ? "inline" : "none";
    cardCurrentIndex = 0;
    applyFilters();
  };

  searchClearBtn.onclick = () => {
    searchInput.value = "";
    currentSearchQuery = "";
    searchClearBtn.style.display = "none";
    applyFilters();
  };

  // 메인 학습 네비게이션 탭 전환
  document.querySelectorAll(".study-nav-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".study-nav-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const mode = btn.getAttribute("data-mode");
      document.querySelectorAll(".view-panel").forEach(panel => panel.classList.remove("active"));
      
      const targetView = document.getElementById(`${mode}View`);
      if (targetView) targetView.classList.add("active");

      if (mode === "quiz") {
        startQuiz();
      } else if (mode === "typing") {
        updateTypingUI();
      } else if (mode === "list") {
        renderVocabGrid();
      }
    };
  });

  // 플래시카드 이벤트
  flashcardEl.onclick = flipCard;
  document.getElementById("cardNextBtn").onclick = nextCard;
  document.getElementById("cardPrevBtn").onclick = prevCard;
  document.getElementById("cardMasterBtn").onclick = markCardMastered;
  document.getElementById("cardReviewBtn").onclick = markCardReview;
  cardBookmarkBtnFront.onclick = (e) => { e.stopPropagation(); toggleBookmarkCurrentWord(); };
  cardBookmarkBtnBack.onclick = (e) => { e.stopPropagation(); toggleBookmarkCurrentWord(); };

  document.getElementById("ttsPlayBtn").onclick = () => {
    const currentWord = currentFilteredWords[cardCurrentIndex];
    if (currentWord) speakWord(currentWord.word);
  };
  document.getElementById("autoPlayBtn").onclick = toggleAutoPlay;
  document.getElementById("cardShuffleBtn").onclick = () => {
    currentFilteredWords.sort(() => 0.5 - Math.random());
    cardCurrentIndex = 0;
    updateFlashcardUI();
  };

  // 키보드 단축키
  window.addEventListener("keydown", (e) => {
    // 인풋 입력 중에는 단축키 비활성화
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;

    if (e.code === "Space") {
      e.preventDefault();
      flipCard();
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      markCardMastered();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      markCardReview();
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      const currentWord = currentFilteredWords[cardCurrentIndex];
      if (currentWord) speakWord(currentWord.word);
    }
  });

  // 퀴즈 관련 버튼
  document.getElementById("quizNextBtn").onclick = () => {
    quizIndex++;
    renderQuizQuestion();
  };
  document.getElementById("quizRestartBtn").onclick = () => startQuiz();
  document.getElementById("quizReviewWrongBtn").onclick = () => {
    const wrongList = getAllWords().filter(w => quizWrongIds.includes(w.id));
    if (wrongList.length > 0) {
      startQuiz(wrongList);
    } else {
      alert("틀린 문제가 없습니다! 전체 퀴즈를 다시 시작합니다.");
      startQuiz();
    }
  };
  document.getElementById("quizTtsBtn").onclick = () => {
    const currentQ = quizPool[quizIndex];
    if (currentQ) speakWord(currentQ.word);
  };

  // 타이핑 관련 버튼
  document.getElementById("typingSubmitBtn").onclick = checkTypingAnswer;
  document.getElementById("typingInput").onkeydown = (e) => {
    if (e.key === "Enter") checkTypingAnswer();
  };
  document.getElementById("typingNextBtn").onclick = () => {
    typingIndex++;
    updateTypingUI();
  };
  document.getElementById("typingHintBtn").onclick = showTypingHint;

  // 단어장 정렬 셀렉트
  document.getElementById("listSortSelect").onchange = renderVocabGrid;

  // 데이터 백업 (JSON 다운로드)
  document.getElementById("exportDataBtn").onclick = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `toeic_voca_backup_${new Date().toISOString().slice(0, 10)}.json`);
    dlAnchor.click();
  };

  // 진행도 초기화
  document.getElementById("resetDataBtn").onclick = () => {
    if (confirm("정말로 모든 학습 진도와 단어장 데이터를 초기화하시겠습니까?")) {
      state = { ...defaultState };
      saveState();
      updateStatsUI();
      applyFilters();
      alert("모든 데이터가 초기화되었습니다.");
    }
  };

  // 모달 제어 (단어 추가)
  const modal = document.getElementById("addWordModal");
  document.getElementById("addWordModalBtn").onclick = () => {
    modal.style.display = "flex";
  };
  document.getElementById("closeModalBtn").onclick = () => {
    modal.style.display = "none";
  };
  document.getElementById("cancelAddBtn").onclick = () => {
    modal.style.display = "none";
  };

  document.getElementById("addWordForm").onsubmit = (e) => {
    e.preventDefault();
    const newWordItem = {
      id: Date.now(),
      word: document.getElementById("newWord").value.trim(),
      partOfSpeech: document.getElementById("newPos").value,
      phonetic: document.getElementById("newPhonetic").value.trim() || "/-/",
      level: document.getElementById("newLevel").value,
      meaning: document.getElementById("newMeaning").value.trim(),
      exampleEn: document.getElementById("newExampleEn").value.trim() || "Example in business context.",
      exampleKo: document.getElementById("newExampleKo").value.trim() || "비즈니스 문맥 예문",
      collocation: document.getElementById("newCollocation").value.trim() || "-",
      synonyms: "-",
      category: document.getElementById("newCategory").value.trim() || "사용자 추가"
    };

    state.customWords = state.customWords || [];
    state.customWords.push(newWordItem);
    saveState();
    modal.style.display = "none";
    document.getElementById("addWordForm").reset();

    applyFilters();
    alert(`"${newWordItem.word}" 단어가 성공적으로 추가되었습니다!`);
  };
}

// --------------------------------------------------------
// 초기화 실행
// --------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  loadState();

  // 테마 초기화
  document.body.setAttribute("data-theme", state.theme);
  document.getElementById("themeIcon").textContent = state.theme === "dark" ? "🌙" : "☀️";
  document.getElementById("soundIcon").textContent = state.soundEnabled ? "🔊" : "🔇";

  updateStatsUI();
  applyFilters();
  initEventListeners();
});
