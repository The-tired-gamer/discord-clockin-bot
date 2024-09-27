require("dotenv").config();

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Collection, EmbedBuilder, PermissionsBitField, Events} = require("discord.js");
const fs = require("fs");
const path = require("path");
const schedule = require("node-schedule");
const { saveUserClockData, loadUserClockData, getAllUserIds } = require('./database');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
    ],
});
const SAVE_INTERVAL = 60 * 1000; // 60 secunde
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const GRAD_PARAMEDICI = process.env.GRAD_PARAMEDICI;
const GRAD_RESURSE = process.env.GRAD_RESURSE;
const footerIconUrl = process.env.FOOTER_ICON_URL;
const logChannelId = process.env.CANAL_LOGURI 
const rest = new REST({ version: "10" }).setToken(TOKEN);
let userClockData = {};
let initialUserClockData = {};
setInterval(saveAllUserClockData, SAVE_INTERVAL);
//setInterval(monitorUsers, 60000); // Verifică la fiecare minut

// Mesaj de pornire
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await loadAllUserClockData();
});

//Obținerea username-ului utilizatorului
async function getUsernameFromDiscord(userId) {
    try {
        const user = await client.users.fetch(userId);
        return user.username;
    } catch (error) {
        console.error(`Eroare la obținerea username-ului pentru utilizatorul ${userId}:`, error);
        return null;
    }
}

// Încărcarea datelor pentru toți utilizatorii
async function loadAllUserClockData() {
    const query = `SELECT * FROM user_clock_data`;
    getAllUserIds((err, userIds) => {
        if (err) {
            console.error('Eroare la obținerea ID-urilor utilizatorilor:', err);
            return;
        }
        for (const userId of userIds) {
            loadUserClockData(userId, (err, data) => {
                if (err) {
                    console.error(`Eroare la încărcarea datelor pentru utilizatorul ${userId}:`, err);
                } else if (data) {
                    userClockData[userId] = data;
                    initialUserClockData[userId] = { ...data };
                }
            });
        }
    });
}

// Verificarea prezenței pe Kronos
function checkKronosPresence(userPresence) {
    return (
        userPresence &&
        userPresence.activities.some(
            (activity) =>
                activity.name === "KRONOS România" && activity.type === 0
        )
    );
}

// Funcție pentru pluralizare
function pluralize(value, singular, plural) {
    return value === 1 ? singular : plural;
}

// Incarcarea comenzilor slash
const commands = [
        new SlashCommandBuilder()
        .setName("pontaje_descise")
        .setDescription("Verifică cine are pontaj activ"),
    new SlashCommandBuilder()
        .setName("pontaj_total")
        .setDescription("Calculează pontajul pe ultimele 7 zile")
        .addUserOption(option =>
            option.setName("user").setDescription("Membrul pentru care se calculează pontajul").setRequired(true)),
].map(command => command.toJSON());



(async () => {
    try {
        console.log("Înregistrare comenzi slash...");
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log("Comenzi slash înregistrate cu succes.");
    } catch (error) {
        console.error("Eroare la înregistrarea comenzilor slash:", error);
    }
})();

// Comenzi slash
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, user } = interaction;
    const guildMember = await interaction.guild.members.fetch(interaction.user.id);
    
    switch (commandName) {
case 'pontaje_descise':
    const clockedInList = Object.entries(userClockData).map(([id, data]) => {
        if (data.isClockedIn) {
            const clockInTime = new Date(data.clockInTime);
            const durationInMinutes = Math.floor((new Date() - clockInTime) / 1000 / 60);
            const formattedClockInTime = clockInTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return `<@${id}> - Pontaj deschis la ora: ${formattedClockInTime} (${durationInMinutes} minute)`;
        }
    }).filter(Boolean).join('\n');

    const embed = new EmbedBuilder()
        .setColor("#00FF00")
        .setTitle("Membri cu pontajul deschis")
        .setDescription(clockedInList)
        .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
    break;
case 'pontaj_total':
    const targetUser = options.getUser('user');
    const userId = targetUser.id;

    // Încarcă datele utilizatorului din baza de date
    loadUserClockData(userId, async (err, userData) => {
        if (err) {
            await interaction.reply(`Eroare la încărcarea datelor pentru utilizatorul <@${userId}>.`);
            return;
        }

        if (!userData) {
            await interaction.reply(`Utilizatorul <@${userId}> nu are date de pontaj.`);
            return;
        }

        const totalTimeWorked = userData.totalMinutes || 0;
        const totalDays = Math.floor(totalTimeWorked / (60 * 24));
        const totalHours = Math.floor((totalTimeWorked % (60 * 24)) / 60);
        const totalMinutes = Math.round(totalTimeWorked % 60);

        let replyMessage = `**<@${userId}>** a lucrat `;
        if (totalDays > 0) {
            replyMessage += `**${totalDays} ${pluralize(totalDays, 'zi', 'zile')}, **`;
        }
        if (totalHours > 0) {
            replyMessage += `**${totalHours} ${pluralize(totalHours, 'oră', 'ore')}** `;
        }
        if (totalMinutes > 0 || (totalDays === 0 && totalHours === 0)) {
            replyMessage += `**${totalMinutes} ${pluralize(totalMinutes, 'minut', 'minute')}** `;
        }
        replyMessage += `în total.`;

        await interaction.reply({ content: replyMessage, ephemeral: true });
    });
    break;
    }
});

// Functie de pornire a pontajului
async function clockIn(userId) {
    const guildMember = await client.guilds.cache.get(GUILD_ID).members.fetch(userId);
    if (!guildMember.roles.cache.has(GRAD_PARAMEDICI)) {
        console.error(`Utilizatorul nu are gradul de paramedic.`);
        return;
    }

    const userData = userClockData[userId] || {};
    userData.history = userData.history || [];

    // Verifică dacă ultima intrare este de tip 'in'
    if (userData.history.length > 0 && userData.history[userData.history.length - 1].type === 'in') {
    //    console.log(`Utilizatorul ${userId} este deja pontat.`);
        return;
    }

    userData.clockInTime = new Date();
    userData.history.push({ type: 'in', time: userData.clockInTime });

    if (!userData.username) {
        userData.username = await getUsernameFromDiscord(userId);
    }

    userClockData[userId] = userData;
    saveUserClockData(userId, userData);
}

// Functie de oprire a pontajului
async function clockOut(userId, username) {
    const userData = userClockData[userId];
    if (!userData || !userData.clockInTime) {
        return;
    }

    if (userData.rank !== 'paramedic') {
        return;
    }

    const clockOutTime = new Date();
    userData.history.push({ type: 'out', time: clockOutTime });

    // Calculați timpul total lucrat
    const clockInTime = new Date(userData.clockInTime);
    const minutesWorked = Math.floor((clockOutTime - clockInTime) / 1000 / 60);
    
    userData.totalMinutes = (userData.totalMinutes || 0) + minutesWorked;
    userData.clockInTime = null; // Resetăm clockInTime la null

    saveUserClockData(userId, userData);
}

// Functie de verificare a prezentei - DUPLICAT (TREBUIE STERS)
client.on('presenceUpdate', async (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.user) return;

    const userId = newPresence.user.id;
    const guildMember = await newPresence.guild.members.fetch(userId);
    const username = newPresence.user.username;
    const isOnKronos = checkKronosPresence(newPresence);

    // Verifică dacă utilizatorul are rolul de Paramedici
    if (!guildMember.roles.cache.has(GRAD_PARAMEDICI)) return;

    if (isOnKronos) {
        await clockIn(userId, username);
    } else {
        await clockOut(userId, username);
    }
});


// Functie de verificare a prezentei
client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
    if (!newPresence || !newPresence.user) return;

    const userId = newPresence.user.id;

    const guildMember = await newPresence.guild.members.fetch(userId);
    const isOnKronos = checkKronosPresence(newPresence);

    if (!guildMember.roles.cache.has(GRAD_PARAMEDICI)) return; // Verifică dacă utilizatorul are rolul de Paramedici

    // Dacă utilizatorul a intrat pe KRONOS România
    if (isOnKronos && !userClockData[userId]?.isClockedIn) {
        userClockData[userId] = {
            isClockedIn: true,
            clockInTime: new Date(),
            history: userClockData[userId]?.history || [],
        };

        // Adaugă ora de intrare în istoric
        userClockData[userId].history.push({
            type: 'in',
            time: new Date(),
        });

        const timeZone = 'Europe/Bucharest';

        const clockInDate = userClockData[userId].clockInTime.toLocaleDateString("ro-RO", {
            weekday: "long",
            month: "long",
            day: "numeric",
        });

        const formattedClockInTime = new Intl.DateTimeFormat('ro-RO', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timeZone,
        }).format(userClockData[userId].clockInTime);

        const embed = new EmbedBuilder()
            .setColor("#00FF00")
            .setTitle("⏰ Pontaj început")
            .setDescription(
                `**<@${userId}>** ai început pontajul automat la ora: **${formattedClockInTime}**\nData: **${clockInDate}**.`,
            )
            .setFooter({ text: `Mesaj trimis ${clockInDate}`, iconURL: footerIconUrl })
            .setTimestamp();

        try {
            await newPresence.user.send({ embeds: [embed] });

            if (logChannelId) {
                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor("#00FF00")
                        .setTitle("⏰ Pontaj Început")
                        .setDescription(
                            `**<@${userId}>** a început pontajul la ora: **${userClockData[userId].clockInTime.toLocaleTimeString([], { 
                                hour: "2-digit", 
                                minute: "2-digit",
                            })}**\nData: **${clockInDate}**.`,
                        )
                        .setFooter({ text: `Mesaj trimis ${clockInDate}`, iconURL: footerIconUrl })
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }
        } catch (error) {
            console.error(
                `**<@${userId}>** Nu am putut trimite în privat pontajul.`,
                error,
            );
        }
    }

    // Dacă utilizatorul a ieșit de pe KRONOS România
    if (!isOnKronos && userClockData[userId]?.isClockedIn) {
        const clockOutTime = new Date();
        const timeWorked = (clockOutTime - userClockData[userId].clockInTime) / 1000 / 60;
        userClockData[userId].isClockedIn = false;
        userClockData[userId].clockInTime = null;

        // Adaugă ora de ieșire în istoric
        userClockData[userId].history.push({
            type: 'out',
            time: new Date(),
        });

        const totalHours = Math.floor(timeWorked / 60);
        const totalMinutes = Math.round(timeWorked % 60);

        const clockOutDate = clockOutTime.toLocaleDateString("ro-RO", {
            weekday: "long",
            month: "long",
            day: "numeric",
        });

        const embed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("🛑 Pontaj oprit")
            .setDescription(
                `**<@${userId}>** ai fost activ **${totalHours} ore și ${totalMinutes} minute**.\nData: **${clockOutDate}**.`,
            )
            .setFooter({ text: `Mesaj trimis ${clockOutDate}`, iconURL: footerIconUrl })
            .setTimestamp();

        try {
            await newPresence.user.send({ embeds: [embed] });

            if (logChannelId) {
                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setColor("#FF0000")
                        .setTitle("🛑 Pontaj Oprit")
                        .setDescription(
                            `**<@${userId}>** a fost activ **${totalHours} ore și ${totalMinutes} minute**.`,
                        )
                        .setFooter({ text: `Mesaj trimis ${clockOutDate}`, iconURL: footerIconUrl })
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            }
        } catch (error) {
            console.error(
                `**<@${userId}>** Nu am putut trimite în privat pontajul.`,
                error,
            );
        }
    }
});


// Salvarea datelor la fiecare 60 de secunde
async function saveAllUserClockData() {
    for (const userId in userClockData) {
        const userData = userClockData[userId];
        
        let totalMinutes = 0;
        let lastClockInTime = null;

        userData.history.forEach(entry => {
            if (entry.type === 'in') {
                lastClockInTime = new Date(entry.time);
            } else if (entry.type === 'out' && lastClockInTime) {
                const clockOutTime = new Date(entry.time);
                totalMinutes += Math.floor((clockOutTime - lastClockInTime) / 1000 / 60);
                lastClockInTime = null;
            }
        });

        if (userData.isClockedIn && lastClockInTime) {
            const now = new Date();
            totalMinutes += Math.floor((now - lastClockInTime) / 1000 / 60);
        }

        userData.totalMinutes = totalMinutes;

        if (!userData.username) {
            userData.username = await getUsernameFromDiscord(userId);
        }

        saveUserClockData(userId, userData);
    }
}

// Salvarea datelor la oprirea botului
process.on('SIGINT', () => {
    console.log('Procesul a fost întrerupt, salvăm datele...');
    for (const userId in userClockData) {
        saveAllUserClockData();
    }
    process.exit();
});

// Salvarea datelor la oprirea botului
process.on('exit', () => {
    console.log('Procesul se închide, salvăm datele...');
    for (const userId in userClockData) {
        saveAllUserClockData();
    }
});

//Verificare ban/kick
//async function checkDiscordStatus(userId) {
//    // Presupunem că există o funcție care verifică statusul utilizatorului pe Discord
//    getDiscordStatus(userId, (err, status) => {
//        if (err) {
//            console.error('Eroare la verificarea statusului pe Discord:', err);
//            return;
//        }
//        if (status === 'kicked' || status === 'banned') {
//            clockOut(userId);
//        }
//    });
//}
//
// Verificare detinerii gradului de paramedic cand este un grad scos
//client.on('guildMemberUpdate', async (oldMember, newMember) => {
//    const userId = newMember.id;
//
//    // Verifică dacă utilizatorul și-a pierdut gradul de paramedic
//    if (oldMember.roles.cache.has(GRAD_PARAMEDICI) && !newMember.roles.cache.has(GRAD_PARAMEDICI)) {
//        await clockOut(userId);
//    }
//});
//
// Verificare detinerii gradului de paramedic la fiercare minut
//function monitorUsers() {
//    getAllUserIds((err, userIds) => {
//        if (err) {
//            console.error('Eroare la obținerea ID-urilor utilizatorilor:', err);
//            return;
//        }
//        userIds.forEach(userId => {
//            checkParamedicStatus(userId);
//            checkDiscordStatus(userId);
//        });
//    });
//}

// Logarea botului
client.login(TOKEN);