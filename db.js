const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Инициализация таблиц
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS clubs (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            );
            
            CREATE TABLE IF NOT EXISTS national_teams (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            );
            
            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                date TIMESTAMP NOT NULL,
                tournament_type TEXT NOT NULL,
                player1 TEXT NOT NULL,
                player2 TEXT NOT NULL,
                team1 TEXT,
                team2 TEXT,
                score1 INTEGER NOT NULL,
                score2 INTEGER NOT NULL,
                penalties TEXT
            );
            
            CREATE TABLE IF NOT EXISTS tournaments (
                id SERIAL PRIMARY KEY,
                date TIMESTAMP NOT NULL,
                type TEXT NOT NULL,
                winner TEXT NOT NULL,
                winner_team TEXT,
                winner_points INTEGER,
                participants TEXT,
                matches TEXT
            );
        `);
        console.log('✅ База данных инициализирована');
    } catch (error) {
        console.error('❌ Ошибка инициализации БД:', error);
        throw error;
    }
}

// ============ КЛУБЫ ============

async function getClubs() {
    const result = await pool.query('SELECT name FROM clubs ORDER BY id');
    return result.rows.map(r => r.name);
}

async function addClub(name) {
    try {
        await pool.query('INSERT INTO clubs (name) VALUES ($1)', [name]);
        return true;
    } catch (error) {
        if (error.code === '23505') return false; // уже существует
        throw error;
    }
}

async function removeClub(name) {
    const result = await pool.query('DELETE FROM clubs WHERE name = $1', [name]);
    return result.rowCount > 0;
}

async function setClubs(names) {
    // Используется для первичной миграции
    await pool.query('DELETE FROM clubs');
    for (const name of names) {
        await pool.query('INSERT INTO clubs (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
}

// ============ СБОРНЫЕ ============

async function getNationalTeams() {
    const result = await pool.query('SELECT name FROM national_teams ORDER BY id');
    return result.rows.map(r => r.name);
}

async function setNationalTeams(names) {
    await pool.query('DELETE FROM national_teams');
    for (const name of names) {
        await pool.query('INSERT INTO national_teams (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
}

// ============ МАТЧИ ============

async function recordMatch(match, participants, tournamentType) {
    const player1Data = participants.find(p => p.name === match.player1);
    const player2Data = participants.find(p => p.name === match.player2);

    await pool.query(
        `INSERT INTO matches (date, tournament_type, player1, player2, team1, team2, score1, score2, penalties)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
            new Date().toISOString(),
            tournamentType,
            match.player1,
            match.player2,
            player1Data ? player1Data.team : null,
            player2Data ? player2Data.team : null,
            match.score1,
            match.score2,
            match.penalties
        ]
    );
}

async function getAllMatches() {
    const result = await pool.query('SELECT * FROM matches ORDER BY date ASC');
    return result.rows.map(r => ({
        date: r.date,
        tournamentType: r.tournament_type,
        player1: r.player1,
        player2: r.player2,
        team1: r.team1,
        team2: r.team2,
        score1: r.score1,
        score2: r.score2,
        penalties: r.penalties
    }));
}

// ============ ТУРНИРЫ ============

async function recordTournament(tournament, winner) {
    await pool.query(
        `INSERT INTO tournaments (date, type, winner, winner_team, winner_points, participants, matches)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            new Date().toISOString(),
            tournament.type,
            winner.name,
            winner.team,
            winner.points,
            JSON.stringify(tournament.participants),
            JSON.stringify(tournament.matches)
        ]
    );
}

async function getAllTournaments() {
    const result = await pool.query('SELECT * FROM tournaments ORDER BY date ASC');
    return result.rows.map(r => ({
        date: r.date,
        type: r.type,
        winner: r.winner,
        winnerTeam: r.winner_team,
        winnerPoints: r.winner_points,
        participants: JSON.parse(r.participants || '[]'),
        matches: JSON.parse(r.matches || '[]')
    }));
}

// ============ МИГРАЦИЯ ============

async function isDatabaseEmpty() {
    const clubsResult = await pool.query('SELECT COUNT(*) FROM clubs');
    return parseInt(clubsResult.rows[0].count) === 0;
}

module.exports = {
    initDatabase,
    getClubs, addClub, removeClub, setClubs,
    getNationalTeams, setNationalTeams,
    recordMatch, getAllMatches,
    recordTournament, getAllTournaments,
    isDatabaseEmpty
};