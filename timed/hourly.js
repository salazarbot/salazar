import client from "../src/Client.js"
import { config } from "../src/Server.js";
import botConfig from "../config.json" with {type: "json"};
import { addContext, getAllPlayers, getContext, getCurrentDate } from "../src/Roleplay.js";
import { aiGenerate } from "../src/AIUtils.js";
import gis from "g-i-s";
import "dotenv/config";
import { ChannelType, WebhookClient } from "discord.js";
import { chunkifyText } from "../src/StringUtils.js";

export default {
    name: 'hourly',
    cron: '0 */1 * * *',

    async execute() {

        // Ações aleatórias NPC
        client.guilds.cache.forEach(async guild => {

            const serverConfig = await config(guild.id);
            const randomActionsChannel = guild.channels.cache.get(serverConfig?.server?.channels?.npc_random_actions);

            if(!randomActionsChannel) return;
            if(serverConfig?.server_tier < 3) return;

            const actionContext = await getContext(guild);
            const serverRoleplayDate = await getCurrentDate(guild);
            const serverOwnedCountries = await getAllPlayers(guild);

            console.log(`- Ação NPC aleatória sendo executada em ${guild.name} (${guild.id})`);

            const prompt = eval("`" + process.env.PROMPT_NPC_ACTION + "`");
            const response = await aiGenerate(prompt);

            var json;
            try {
                var json = JSON.parse("{"+response.text.split('{')[1].split('}')[0]+"}");
            } catch (error) {
                return console.error('Algo deu errado em ação aleatória NPC: '+response.text);
            }

            if( !json || !json['pais'] || !json['acao'] || !json['narracao'] || !json['contexto'] ) return console.error(response.text);

            await gis(`Bandeira ${json['pais']} ${serverRoleplayDate}`, async (error, results) => {
                
                const validResult = results[0];

                let webhookContent = {
                    username: json['pais'],
                    content: json['acao'],
                };

                if(validResult) webhookContent['avatarURL'] = validResult?.url

                const webhookUrl = (await randomActionsChannel.fetchWebhooks()).find(w => w.owner == client.user.id) ? 
                    (await randomActionsChannel.fetchWebhooks()).find(w => w.owner == client.user.id).url
                :
                    (await randomActionsChannel.createWebhook({name: 'Webhook do salazar'})).url

                const webhookClient = new WebhookClient({ url: webhookUrl });

                const actionMessage = await webhookClient.send(webhookContent);

                const narrationsChannel = guild.channels.cache.get(serverConfig?.server?.channels?.narrations);

                // Se houver bloco diff, ele fica em um chunk separado
                const diffStart = json['narracao'].indexOf('```diff');
                let mainText = json['narracao'];
                let diffChunk = null;
                if (diffStart !== -1) {
                    mainText = json['narracao'].slice(0, diffStart);
                    diffChunk = json['narracao'].slice(diffStart);
                }

                let finalText = `# Ação de ${json['pais']} (NPC)\n- Ação original: https://discord.com/channels/${guild.id}/${actionMessage.channel_id}/${actionMessage.id}\n${mainText}`;
                const chunks = chunkifyText(finalText);
                if (diffChunk) chunks.push(diffChunk);
                chunks.push(`\n-# Narração gerada por Inteligência Artificial. [Saiba mais](${botConfig.site})`);

                chunks.forEach(chunk => narrationsChannel?.send(chunk));
                addContext(json['contexto'], guild);

            });

        });

    }
}