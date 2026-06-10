/**
 * scripts/importDiaryData.js
 * 
 * Import diary data from text files into SQLite
 * Run after Setup.js: node scripts/importDiaryData.js
 * 
 * Imports:
 *  - jadeed_history.txt → diary_logs (type='jadeed')
 *  - murajah_history.txt → diary_logs (type='murajah')
 */

"use strict";

require("dotenv").config();

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const DB_PATH = path.resolve(__dirname, "../data/quran.db");
const JADEED_PATH = path.resolve(__dirname, "../data/jadeed_history.txt");
const MURAJAH_PATH = path.resolve(__dirname, "../data/murajah_history.txt");
const QURANMAP_PATH = path.resolve(__dirname, "../data/heatmap_data.txt");
const USER_ID = 1; // Assuming single user for this import

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) { console.error("❌ Cannot open database:", err.message); process.exit(1); }
    console.log("✅ Connected to:", DB_PATH);
});

db.run("PRAGMA journal_mode=WAL");
db.run("PRAGMA foreign_keys=ON");

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res({ id: this.lastID, changes: this.changes }); }));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, rows) => e ? rej(e) : res(rows)));

// Parse date format: DD/MM/YYYY to YYYY-MM-DD
function parseDate(dateStr) {
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Import JADEED data
async function importJadeed() {
    console.log("\n📖 Importing JADEED data...");

    if (!fs.existsSync(JADEED_PATH)) {
        console.log("   ⚠️  jadeed_history.txt not found");
        return;
    }

    const lines = fs.readFileSync(JADEED_PATH, "utf8").split("\n").filter(l => l.trim() && !l.startsWith("//"));

    let count = 0;
    await run("BEGIN TRANSACTION");

    for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 4) continue;

        const [dateStr, rangeFrom, rangeTo, scoreStr] = parts;
        const score = parseInt(scoreStr);

        if (isNaN(score)) continue;

        try {
            const created_at = parseDate(dateStr);
            await run(
                `INSERT OR REPLACE INTO diary_logs (user_id, type, range_from, range_to, score, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [USER_ID, 'jadeed', rangeFrom, rangeTo, score, created_at]
            );
            count++;
        } catch (e) {
            console.error(`   ❌ Error parsing line: ${line}`);
        }
    }

    await run("COMMIT");
    console.log(`   ✅ Imported ${count} JADEED records`);
}

// Import MURAJAH data - Fixed Parser
async function importMurajah() {
    console.log("\n📚 Importing MURAJAH data...");

    if (!fs.existsSync(MURAJAH_PATH)) {
        console.log("   ⚠️  murajah_history.txt not found");
        return;
    }

    const content = fs.readFileSync(MURAJAH_PATH, "utf8");
    const lines = content.split("\n");

    let count = 0;
    await run("BEGIN TRANSACTION");

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines, headers, markdown, comments
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed === "---" || trimmed.startsWith("Sorted")) {
            continue;
        }

        // Match: DD/MM/YYYY — or DD/MM/YYYY →
        // Handles both formats: with arrow (→) and with double dash (—)
        const match = trimmed.match(/^(\d{2}\/\d{2}\/\d{4})\s*[→—|]\s*(.+)$/);
        if (!match) continue;

        const dateStr = match[1];
        const itemsStr = match[2];

        // Parse items like "30 (9), 1 (8)" or "11 (9) | 10 (8)"
        const itemsRaw = itemsStr.split(/[,|]/);

        for (const item of itemsRaw) {
            const cleaned = item.trim();
            if (!cleaned || cleaned === "N/A" || cleaned.startsWith("–")) continue;

            // Match: JUZNUM (SCORE)
            const itemMatch = cleaned.match(/^(\d+)\s*\((\d+)\)$/);
            if (!itemMatch) continue;

            const juzNum = itemMatch[1];
            const score = parseInt(itemMatch[2]);

            if (isNaN(score) || score < 0 || score > 10) continue;

            try {
                const created_at = parseDate(dateStr);
                await run(
                    `INSERT OR REPLACE INTO diary_logs (user_id, type, range_from, range_to, score, created_at)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [1, 'murajah', `Juz ${juzNum}`, `Juz ${juzNum}`, score, created_at]
                );
                count++;
            } catch (e) {
                console.error(`   ❌ Error parsing line: ${line}`);
            }
        }
    }

    await run("COMMIT");
    console.log(`   ✅ Imported ${count} MURAJAH records`);
}
async function importHeatmap() {
    console.log("\n🔥 Importing HEATMAP data...");

    if (!fs.existsSync(QURANMAP_PATH)) {
        console.log("   ⚠️ heatmap_data.txt not found");
        return;
    }

    const lines = fs.readFileSync(QURANMAP_PATH, "utf8").split("\n");

    let currentSipara = null;
    let count = 0;

    await run("BEGIN TRANSACTION");

    try {
        for (const raw of lines) {
            const line = raw.trim();

            if (!line || line === "---") continue;

            const siparaMatch = line.match(/^Sipara\s+(\d+)$/i);
            if (siparaMatch) {
                currentSipara = parseInt(siparaMatch[1]);
                continue;
            }

            const pageMatch = line.match(
                /^Page\s+(\d+)\((\d+)\)\s*→\s*([\d.]+)$/
            );

            if (!pageMatch || currentSipara === null) continue;

            const pageInSipara = parseInt(pageMatch[1]);
            const quranPage = parseInt(pageMatch[2]);
            const score = parseFloat(pageMatch[3]);

            await run(
                `INSERT INTO heatmap_scores
                 (user_id, sipara, page_number, quran_page, score)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    USER_ID,
                    currentSipara,
                    pageInSipara,
                    quranPage,
                    score
                ]
            );

            count++;
        }

        await run("COMMIT");
        console.log(`   ✅ Imported ${count} heatmap records`);
    } catch (err) {
        await run("ROLLBACK");
        throw err;
    }
}
// Verify import
async function verifyImport() {
    console.log("\n📊 Verifying import...");
    try {
        const jadeedCount = await all("SELECT COUNT(*) as cnt FROM diary_logs WHERE type = 'jadeed' AND user_id = 1");
        const murajahCount = await all("SELECT COUNT(*) as cnt FROM diary_logs WHERE type = 'murajah' AND user_id = 1");
        
        console.log(`   Jadeed:  ${jadeedCount[0].cnt} records`);
        console.log(`   Murajah: ${murajahCount[0].cnt} records`);
        
        const sampleJadeed = await all("SELECT * FROM diary_logs WHERE type = 'jadeed' AND user_id = 1 LIMIT 1");
        const sampleMurajah = await all("SELECT * FROM diary_logs WHERE type = 'murajah' AND user_id = 1 LIMIT 1");
        
        if (sampleJadeed.length > 0) console.log("   Sample Jadeed:", sampleJadeed[0]);
        if (sampleMurajah.length > 0) console.log("   Sample Murajah:", sampleMurajah[0]);
    } catch (err) {
        console.error("   ❌ Verification failed:", err.message);
    }
}

// Main
(async () => {
    try {
        await importHeatmap();
        await importJadeed();
        await importMurajah();
        await verifyImport();
        console.log("\n🎉 Diary data import complete!\n");
    } catch (err) {
        console.error("\n❌ Import failed:", err.message);
        process.exit(1);
    } finally {
        db.close();
    }
})();
