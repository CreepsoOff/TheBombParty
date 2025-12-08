const socket = io();

console.log("🚀 Client JS v6 chargé");

// DOM Elements
const views = { login: document.getElementById('login-screen'), game: document.getElementById('game-interface') };
const arena = document.getElementById('arena');
const pContainer = document.getElementById('players-container');
const pointer = document.getElementById('pointer');
const mainInput = document.getElementById('main-input');
const chatFeed = document.getElementById('chat-feed');
const localAlphaGrid = document.getElementById('local-alphabet-grid');

// AUDIO
const audioCtx = {
    explode: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/GalaxyInvaders/explosion_02.mp3'),
    error: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/assets/sounddogs/missile.mp3'),
    success: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/pang/pop.mp3')
};
Object.values(audioCtx).forEach(a => a.volume = 0.3);

function playSound(name) {
    if(audioCtx[name]) {
        audioCtx[name].currentTime = 0;
        audioCtx[name].play().catch((e) => {});
    }
}

// Variables Globales
let myId = null;
let isAdmin = false;
let gameActive = false;
let currentSyllable = "";
let localPlayers = [];
let isMyTurn = false; // NOUVELLE VARIABLE DE CONTROLE

// --- ALPHABET ---
function initLocalAlphabet() {
    localAlphaGrid.innerHTML = '';
    const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for(let char of alpha) {
        const div = document.createElement('div');
        div.className = 'alpha-letter'; 
        div.id = `local-alpha-${char}`;
        div.textContent = char;
        localAlphaGrid.appendChild(div);
    }
}
initLocalAlphabet();

// --- CONNEXION ---
function joinGame() {
    const user = document.getElementById('username').value;
    if(!user) return;
    
    audioCtx.success.play().catch(()=>{}); 
    
    socket.emit('join-game', user);
    views.login.classList.add('hidden');
    views.game.classList.remove('hidden');
    
    document.addEventListener('click', (e) => {
        if(!e.target.closest('.chat-panel') && !e.target.closest('.settings-modal')) {
            mainInput.focus();
        }
    });
    mainInput.focus();
}

function toggleChat() {
    document.getElementById('chat-panel').classList.toggle('collapsed');
}
function sendStart() { 
    socket.emit('start-command'); 
}

// --- SETTINGS ---
function toggleSettings() {
    document.getElementById('settings-modal').classList.toggle('hidden');
    const canEdit = isAdmin && !gameActive;
    document.getElementById('settings-content').style.pointerEvents = canEdit ? 'auto' : 'none';
    document.getElementById('save-settings-btn').classList.toggle('hidden', !canEdit);
}
function saveSettings() {
    if(!isAdmin) return;
    const settings = {
        initialLives: parseInt(document.getElementById('set-lives').value),
        minTime: parseInt(document.getElementById('set-min').value),
        maxTime: parseInt(document.getElementById('set-max').value),
    };
    socket.emit('update-settings', settings);
    toggleSettings();
}

// --- CHAT ---
document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim() !== "") {
        socket.emit('send-message', e.target.value);
        e.target.value = "";
    }
});
function addLog(data) {
    const div = document.createElement('div');
    if (data.type === 'system') {
        div.className = 'msg-system'; div.textContent = `${data.time} ${data.text}`;
    } else {
        div.className = 'msg-player';
        // Style spécial pour les fantômes
        if(data.isGhost) div.style.color = '#a5b1c2'; 
        div.innerHTML = `<span class="time">${data.time}</span> <span class="user">${data.user}:</span> ${data.text}`;
    }
    chatFeed.appendChild(div);
    chatFeed.scrollTop = chatFeed.scrollHeight;
}

// --- LAYOUT ---
function updateLayout(players) {
    localPlayers = players;
    pContainer.innerHTML = "";
    
    const radius = Math.min(arena.offsetWidth, arena.offsetHeight) * 0.35;
    const centerX = arena.offsetWidth / 2;
    const centerY = arena.offsetHeight / 2;

    players.forEach((p, index) => {
        const angle = (index / players.length) * 2 * Math.PI - (Math.PI / 2);
        p.angle = angle; 
        
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);

        const card = document.createElement('div');
        card.className = `player-card ${p.lives <= 0 ? 'dead' : ''}`;
        card.id = `card-${p.id}`;
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;

        const hearts = '❤️'.repeat(p.lives);
        
        card.innerHTML = `
            <div class="feedback-icon" id="fb-${p.id}"></div>
            <div class="lives" id="lives-${p.id}">${hearts}</div>
            <div class="avatar">${['🤖','👽','🦊','🐱','🐯','🐸'][p.avatar]}</div>
            <div class="username">${p.username}</div>
            <div class="typing-box" id="type-${p.id}"></div>
        `;
        pContainer.appendChild(card);
    });
}

function triggerFeedback(id, type) {
    const el = document.getElementById(`fb-${id}`);
    const card = document.getElementById(`card-${id}`);
    if(!el || !card) return;

    el.className = 'feedback-icon';
    void el.offsetWidth; 

    if(type === 'success') {
        el.textContent = "👍";
        el.classList.add('pop-anim');
        playSound('success');
    } else if (type === 'error') {
        el.textContent = "❌";
        el.classList.add('cross-anim');
        card.classList.add('shake');
        playSound('error');
        setTimeout(() => card.classList.remove('shake'), 500);
    }
}

// --- JEU INPUT (MODIFIÉ POUR VERROUILLAGE) ---
mainInput.addEventListener('input', () => {
    // Si ce n'est pas mon tour, je ne fais RIEN.
    if (!isMyTurn) {
        mainInput.value = ""; // On nettoie au cas où
        return; 
    }

    socket.emit('typing', mainInput.value);
    updateTyping(socket.id, mainInput.value);
});

mainInput.addEventListener('keydown', (e) => {
    // Si ce n'est pas mon tour, je ne fais RIEN.
    if (!isMyTurn) {
        // Optionnel : empêcher même d'écrire dans l'input
        e.preventDefault(); 
        return;
    }

    if(e.key === 'Enter') {
        socket.emit('submit-word', mainInput.value);
        mainInput.value = '';
        updateTyping(socket.id, '');
    }
});

function updateTyping(id, text) {
    const box = document.getElementById(`type-${id}`);
    if(!box) return;
    
    if(text) {
        box.classList.add('visible');
        if(currentSyllable) {
            const reg = new RegExp(`(${currentSyllable})`, 'i');
            box.innerHTML = text.replace(reg, '<span class="hl">$1</span>');
        } else {
            box.textContent = text;
        }
    } else {
        box.classList.remove('visible');
        box.textContent = '';
    }
}

// --- SOCKET EVENTS ---
socket.on('connect', () => { console.log("Connecté"); });

socket.on('init-settings', (s) => {
    document.getElementById('set-lives').value = s.initialLives;
    document.getElementById('set-min').value = s.minTime;
    document.getElementById('set-max').value = s.maxTime;
});

socket.on('update-players', (data) => {
    isAdmin = (data.adminId === socket.id);
    if (!gameActive && isAdmin && data.players.length >= 2) {
        document.getElementById('start-overlay').classList.remove('hidden');
    } else {
        document.getElementById('start-overlay').classList.add('hidden');
    }
    updateLayout(data.players);
});

socket.on('game-started', (players) => {
    gameActive = true;
    document.getElementById('start-overlay').classList.add('hidden');
    updateLayout(players);
    document.querySelectorAll('.alpha-letter').forEach(d => d.classList.remove('used'));
});

socket.on('chat-message', addLog);

socket.on('new-turn', (data) => {
    currentSyllable = data.syllable;
    document.getElementById('syllable-display').textContent = data.syllable;
    
    // MISE A JOUR DU TOUR
    isMyTurn = (data.playerId === socket.id); // C'est ici qu'on définit si j'ai le droit d'écrire

    const target = localPlayers.find(p => p.id === data.playerId);
    if (target) {
        const deg = (target.angle * 180 / Math.PI) + 90; 
        pointer.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    }

    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
    const active = document.getElementById(`card-${data.playerId}`);
    if(active) active.classList.add('active');

    // Reset visuel typing
    document.querySelectorAll('.typing-box').forEach(b => { b.classList.remove('visible'); b.textContent=''; });
    mainInput.value = "";
    
    // Focus seulement si c'est mon tour
    if(isMyTurn) mainInput.focus();
});

socket.on('player-typing', (d) => updateTyping(d.id, d.text));

socket.on('word-success', (data) => {
    triggerFeedback(data.playerId, 'success');
    
    if(data.playerId === socket.id) {
        if(data.resetAlphabet) {
             document.querySelectorAll('.alpha-letter').forEach(d => d.classList.remove('used'));
        } else {
            data.newLetters.forEach(c => {
                const el = document.getElementById(`local-alpha-${c}`);
                if(el) el.classList.add('used');
            });
        }
    }
    const l = document.getElementById(`lives-${data.playerId}`);
    if(l) l.textContent = '❤️'.repeat(data.lives);
});

socket.on('word-error', () => {
    triggerFeedback(socket.id, 'error');
});

socket.on('explosion', (data) => {
    playSound('explode');
    const bomb = document.getElementById('bomb');
    bomb.style.animation = "none"; 
    bomb.style.transform = "translate(-50%, -50%) scale(1.5)";
    setTimeout(() => {
        bomb.style.transform = "translate(-50%, -50%) scale(1)";
        bomb.style.animation = "bounce 2s infinite ease-in-out"; 
    }, 300);
    
    const l = document.getElementById(`lives-${data.loserId}`);
    if(l) l.textContent = '❤️'.repeat(data.livesLeft);
    triggerFeedback(data.loserId, 'error'); 
});

socket.on('player-eliminated', (id) => {
    const c = document.getElementById(`card-${id}`);
    if(c) c.classList.add('dead');
});

socket.on('game-over', () => {
    gameActive = false;
    isMyTurn = false; // Plus personne ne peut écrire
    document.getElementById('syllable-display').textContent = "FIN";
    if(isAdmin) document.getElementById('start-overlay').classList.remove('hidden');
});

socket.on('reset-game', () => {
    gameActive = false;
    isMyTurn = false;
    document.getElementById('syllable-display').textContent = "STOP";
    if(isAdmin) document.getElementById('start-overlay').classList.remove('hidden');
});

window.addEventListener('resize', () => { if(localPlayers.length > 0) updateLayout(localPlayers); });