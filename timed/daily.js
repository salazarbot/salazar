import client from "../src/Client.js"
import { config } from "../src/Server.js";
import { getCurrentDate, passYear } from "../src/Roleplay.js";
import "dotenv/config";
import { ChannelType } from "discord.js";

export default {
    name: 'daily',
    cron: '0 0 * * *',

    async execute() {

        // Passagem de tempo automática
        client.guilds.cache.forEach(async guild => {

            const serverConfig = await config(guild.id);
            if(!serverConfig) return;
            if(!serverConfig?.server_tier > 0) return;
            const daysToPass = serverConfig?.server?.preferences?.days_to_year;
            if(!daysToPass) return;
            const timePassingChannel = guild.channels.cache.get(serverConfig?.server?.channels?.time);
            if(!timePassingChannel || timePassingChannel.type != ChannelType.GuildText) return;
            const lastBotTimePassage = await timePassingChannel.messages.fetch({ limit: 1, author: client.user.id });
            if(!lastBotTimePassage) return;
            if((Date.now() - lastBotTimePassage?.createdTimestamp) < ((daysToPass * 24 * 60 * 60 * 1000) - (10 * 60 * 1000))) return;

            passYear(guild, parseInt((await getCurrentDate(guild)).match(/\d+/)?.[0]), (parseInt((await getCurrentDate(guild)).match(/\d+/)?.[0]) + 1), true);
            console.log(`- Passando o ano automaticamente em ${guild.name}`);

            timePassingChannel?.send(`# ${(parseInt((await getCurrentDate(guild)).match(/\d+/)?.[0]) + 1)}`).catch(() => {});
            
        });

    }
}