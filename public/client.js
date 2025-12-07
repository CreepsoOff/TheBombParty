const socket = io();

// DOM Elements
const views = {
    login: document.getElementById('login-screen'),
    game: document.getElementById('game-container')
};
const grid = document.getElementById('players-grid');
const mainInput = document.getElementById('main-input');
const syllableDisplay = document.getElementById('syllable-display');
const bomb = document.getElementById('bomb');
const statusMsg = document.getElementById('status-msg');

let myId = null;
let currentSyllable = "";
let isMyTurn = false;

// --- SONS ---
const sounds = {
    pop: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/pang/pop.mp3'), // Placeholder
    explode: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/GalaxyInvaders/explosion_02.mp3'),
    error: new Audio('https://codeskulptor-demos.commondatastorage.googleapis.com/assets/sounddogs/missile.mp3')
};
// Réduire le volume
Object.values(sounds).forEach(s => s.volume = 0.3);

// --- FONCTIONS ---

function joinGame() {
    const user = document.getElementById('username').value;
    if(!user) return;
    socket.emit('join-game', user);
    views.login.classList.add('hidden');
    views.game.classList.remove('hidden');
    
    // Focus permanent sur l'input invisible pour jouer au clavier direct
    document.addEventListener('click', () => mainInput.focus());
    mainInput.focus();
}

function sendStart() {
    socket.emit('start-command');
}

function toggleSettings() {
    document.getElementById('settings-modal').classList.toggle('hidden');
}

function saveSettings() {
    const lives = parseInt(document.getElementById('set-lives').value);
    const min = parseInt(document.getElementById('set-min').value);
    const max = parseInt(document.getElementById('set-max').value);
    socket.emit('update-settings', { initialLives: lives, minTime: min, maxTime: max });
    toggleSettings();
}

// GENERATION DE LA CARTE JOUEUR
function renderPlayer(p) {
    // Alphabet HTML
    let alphaHTML = '';
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    for(let char of alphabet) {
        const found = p.usedLetters.includes(char) ? 'found' : '';
        alphaHTML += `<span class="letter ${found}" id="alpha-${p.id}-${char}">${char}</span>`;
    }

    // Vies (Coeurs)
    let hearts = '❤️'.repeat(p.lives);

    return `
        <div class="player-card ${p.lives <= 0 ? 'dead' : ''}" id="card-${p.id}">
            <div class="cross-anim" id="cross-${p.id}">❌</div>
            <div class="lives" id="lives-${p.id}">${hearts}</div>
            <div class="avatar">
                 ${p.lives > 0 ? getAvatarEmoji(p.avatar) : '💀'}
                 ${p.lives > 0 ? '<span class="floating-emoji hidden" id="float-'+p.id+'">👍</span>' : ''}
            </div>
            <div class="username">${p.username}</div>
            <div class="typing-display" id="type-${p.id}"></div>
            <div class="alphabet-track">${alphaHTML}</div>
        </div>
    `;
}

function getAvatarEmoji(id) {
    const avatars = ['🤖', '🦊', '🐱', '🐼', '🐸', '👽'];
    return avatars[id % avatars.length];
}

function triggerAnim(id, type) {
    const card = document.getElementById(`card-${id}`);
    if(!card) return;

    if(type === 'shake') {
        card.classList.add('shake');
        sounds.error.play();
        const cross = document.getElementById(`cross-${id}`);
        cross.classList.add('show-cross');
        setTimeout(() => {
            card.classList.remove('shake');
            cross.classList.remove('show-cross');
        }, 800);
    }
    
    if(type === 'success') {
        sounds.pop.play();
        const float = document.getElementById(`float-${id}`);
        if(float) {
            float.textContent = "👍"; 
            float.classList.remove('hidden');
            float.style.animation = 'none';
            float.offsetHeight; /* trigger reflow */
            float.style.animation = 'floatUp 1s forwards';
        }
    }
}

// --- GESTION INPUT & TYPING ---

mainInput.addEventListener('input', (e) => {
    if(!isMyTurn) {
        mainInput.value = "";
        return;
    }
    const text = mainInput.value;
    socket.emit('typing', text);
    updateTypingDisplay(socket.id, text);
});

mainInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') {
        socket.emit('submit-word', mainInput.value);
        mainInput.value = '';
        updateTypingDisplay(socket.id, '');
    }
});

function updateTypingDisplay(id, text) {
    const display = document.getElementById(`type-${id}`);
    if(!display) return;

    if(!text) {
        display.innerHTML = "";
        return;
    }

    // Highlight logic
    // On cherche la syllabe dans le texte (insensible à la casse)
    if(currentSyllable) {
        const regex = new RegExp(`(${currentSyllable})`, 'i');
        const html = text.replace(regex, '<span class="highlight">$1</span>');
        display.innerHTML = html;
    } else {
        display.textContent = text;
    }
}

// --- SOCKET EVENTS ---

socket.on('update-players', (players) => {
    // On recrée la grille tout en essayant de ne pas briser les animations en cours
    // Pour simplifier ici, on redraw. Pour opti, on ferait du diffing.
    grid.innerHTML = players.map(renderPlayer).join('');
    
    if(players.length >= 2) document.getElementById('start-overlay').classList.remove('hidden');
});

socket.on('game-started', (players) => {
    document.getElementById('start-overlay').classList.add('hidden');
    statusMsg.textContent = "C'EST PARTI !";
    grid.innerHTML = players.map(renderPlayer).join(''); // Reset propre
});

socket.on('new-turn', (data) => {
    currentSyllable = data.syllable;
    syllableDisplay.textContent = data.syllable;
    
    // Visuel Actif
    document.querySelectorAll('.player-card').forEach(c => c.classList.remove('active'));
    const activeCard = document.getElementById(`card-${data.playerId}`);
    if(activeCard) activeCard.classList.add('active');

    // Input logic
    isMyTurn = (data.playerId === socket.id);
    mainInput.value = "";
    updateTypingDisplay(data.playerId, "");
    
    if(isMyTurn) {
        statusMsg.textContent = "À TOI DE JOUER !";
        statusMsg.style.color = "#2ed573";
        mainInput.focus();
    } else {
        const pName = activeCard ? activeCard.querySelector('.username').innerText : '?';
        statusMsg.textContent = `Au tour de ${pName}`;
        statusMsg.style.color = "#fff";
    }

    // Animation bombe (tick tock simulé)
    bomb.style.animation = "shake 1s infinite";
});

socket.on('player-typing', (data) => {
    updateTypingDisplay(data.id, data.text);
});

socket.on('word-error', (msg) => {
    triggerAnim(socket.id, 'shake');
    statusMsg.textContent = "❌ " + msg;
});

socket.on('word-success', (data) => {
    triggerAnim(data.playerId, 'success');
    
    // Mettre à jour l'alphabet visuellement
    data.newLetters.forEach(char => {
        const el = document.getElementById(`alpha-${data.playerId}-${char}`);
        if(el) el.classList.add('found');
    });

    // Reset alphabet si bonus
    if(data.resetAlphabet) {
        document.querySelectorAll(`#card-${data.playerId} .alphabet-track .letter`).forEach(l => l.classList.remove('found'));
        // Animation spéciale vie bonus
        const float = document.getElementById(`float-${data.playerId}`);
        if(float) { float.textContent = "❤️ +1"; float.style.animation = 'floatUp 2s forwards'; }
    }
    
    // Mettre à jour les vies
    const livesDiv = document.getElementById(`lives-${data.playerId}`);
    if(livesDiv) livesDiv.textContent = '❤️'.repeat(data.lives);
});

socket.on('explosion', (data) => {
    sounds.explode.play();
    statusMsg.textContent = "💥 BOOM !";
    bomb.style.animation = "none";
    bomb.style.transform = "scale(1.5)";
    setTimeout(() => bomb.style.transform = "scale(1)", 300);

    triggerAnim(data.loserId, 'shake');
    
    // Update vies
    const livesDiv = document.getElementById(`lives-${data.loserId}`);
    if(livesDiv) livesDiv.textContent = '❤️'.repeat(data.livesLeft);
});

socket.on('player-eliminated', (id) => {
    const card = document.getElementById(`card-${id}`);
    if(card) {
        card.classList.add('dead');
        card.querySelector('.avatar').innerHTML = '💀';
    }
});

socket.on('game-over', (winner) => {
    syllableDisplay.textContent = "FIN";
    statusMsg.textContent = `VICTOIRE DE ${winner.username} ! 👑`;
    document.getElementById('start-overlay').classList.remove('hidden');
    bomb.style.animation = "none";
});