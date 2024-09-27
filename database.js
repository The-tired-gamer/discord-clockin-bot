require('dotenv').config();
const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: process.env.DB_SSL === 'true'
});

connection.connect((err) => {
    if (err) {
        console.error('Eroare la conectarea la baza de date:', err);
        return;
    }
    console.log('Conectat la baza de date MySQL.');

    connection.query(`CREATE TABLE IF NOT EXISTS user_clock_data (
        user_id VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255),
        clock_in_time DATETIME,
        history TEXT,
        total_minutes INT
    )`, (err) => {
        if (err) {
            console.error('Eroare la crearea tabelului:', err);
        }
    });
});

function saveUserClockData(userId, data) {
    let clockInTimeFormatted = null;
    if (data.clockInTime) {
        try {
            clockInTimeFormatted = new Date(data.clockInTime).toISOString().slice(0, 19).replace('T', ' ');
        } catch (error) {
            console.error('Invalid clockInTime value:', data.clockInTime);
        }
    }

    const totalMinutes = data.totalMinutes || 0;

    const query = `INSERT INTO user_clock_data (user_id, username, clock_in_time, history, total_minutes) 
                   VALUES (?, ?, ?, ?, ?) 
                   ON DUPLICATE KEY UPDATE 
                   username = VALUES(username),
                   clock_in_time = VALUES(clock_in_time), 
                   history = VALUES(history),
                   total_minutes = VALUES(total_minutes)`;

    const values = [
        userId,
        data.username || null,
        clockInTimeFormatted,
        JSON.stringify(data.history),
        totalMinutes
    ];

    connection.query(query, values, (err) => {
        if (err) {
            console.error('Eroare la salvarea datelor:', err);
        } else {
    //        console.log('Datele au fost salvate cu succes.');
        }
    });
}

function getAllUserIds(callback) {
    const query = `SELECT user_id FROM user_clock_data`;
    connection.query(query, (err, results) => {
        if (err) {
            console.error('Eroare la obținerea ID-urilor utilizatorilor:', err);
            callback(err, null);
        } else {
            const userIds = results.map(row => row.user_id);
            callback(null, userIds);
        }
    });
}

function loadUserClockData(userId, callback) {
    const query = `SELECT * FROM user_clock_data WHERE user_id = ?`;
    connection.query(query, [userId], (err, results) => {
        if (err) {
            console.error('Eroare la încărcarea datelor:', err);
            callback(err, null);
        } else {
            if (results.length > 0) {
                const data = results[0];
                callback(null, {
                    username: data.username,
                    clockInTime: data.clock_in_time,
                    history: JSON.parse(data.history),
                    totalMinutes: data.total_minutes
                });
            } else {
                callback(null, null);
            }
        }
    });
}

module.exports = { saveUserClockData, loadUserClockData, getAllUserIds };