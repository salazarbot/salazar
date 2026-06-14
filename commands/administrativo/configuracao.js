import {
    ActionRowBuilder,
    AutocompleteInteraction,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    Colors,
    EmbedBuilder,
    PermissionFlagsBits,
    SlashCommandBooleanOption,
    SlashCommandBuilder,
    SlashCommandChannelOption,
    SlashCommandIntegerOption,
    SlashCommandRoleOption,
    SlashCommandStringOption,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder
} from "discord.js";
import {
    MongoClient,
    ServerApiVersion
} from "mongodb";
import * as Server from "../../src/Server.js";
import botConfig from "../../config.json" with { type: "json" };
import { inspect } from "util";
import { chunkifyText } from "../../src/StringUtils.js";

// Função para criar opções dinamicamente
function buildOptions(builder) {
    // Opção principal para escolher o campo a alterar
    builder.addStringOption(option =>
        option.setName('opção')
            .setDescription('Qual opção deve ser alterada')
            .setRequired(false)
            .setAutocomplete(true)
    );

    // Para cada tipo de argumento, adiciona a opção correspondente
    const types = {
        canal: SlashCommandChannelOption,
        cargo: SlashCommandRoleOption,
        texto: SlashCommandStringOption,
        número: SlashCommandIntegerOption,
        booleano: SlashCommandBooleanOption
    };

    Object.entries(types).forEach(([type, OptionClass]) => {
        const methodName = `add${OptionClass.name.replace('SlashCommand', '').replace('Option', '')}Option`;
        builder[methodName](
            new OptionClass()
                .setName(type)
                .setDescription(`Defina o valor para opções do tipo ${type}`)
                .setRequired(false)
        );
    });

    return builder;
};

// Função recursiva para montar objeto de resposta, respeitando array e booleano
function buildFullConfig(dbConfig, defaultConfig = Server.defaultConfiguration) {
    const result = {};
    for (const key in defaultConfig) {
        const value = defaultConfig[key];
        if (typeof value === "object" && value.input) {
            if (value.array) {
                // Campo array
                result[key] = dbConfig?.[key] ?? [];
            } else if (value.input === "booleano") {
                // Campo booleano
                result[key] = dbConfig?.[key] ?? false;
            } else {
                // Campo simples
                result[key] = dbConfig?.[key] ?? undefined;
            }
        } else if (typeof value === "object") {
            // Subcampo/categoria
            result[key] = buildFullConfig(dbConfig?.[key], value);
        }
    }
    return result;
};

export default {
    data: buildOptions(
        new SlashCommandBuilder()
        .setName('configuração')
        .setDescription(`[Administrativo] Comando para visualizar ou alterar a configuração do ${botConfig.name} no seu servidor`)
    ),

    min_tier: 1,

    /**
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.editReply({
                content: `Você precisa ser um administrador para utilizar esse comando.`
            });
        }

        const serverConfig = await Server.config(interaction.guildId);
        const option = interaction.options.get('opção')?.value;

        // Verifica se a opção é um campo de array
        const arrayOptions = Object.entries(Server.optionsAlike)
        .filter(([key]) => {
            // Busca no defaultConfiguration se tem array: true
            const parts = key.split('.');
            let ref = Server.defaultConfiguration;
            for (const part of parts) {
                ref = ref?.[part];
            }
            return ref?.array === true;
        })
        .map(([key]) => key);

        const mongoClient = new MongoClient(process.env.DB_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
        });        

        try {
            await mongoClient.connect();

            const collection = mongoClient.db('Salazar').collection('configuration');

            // Exibir configuração atual
            if(!option) {
                const replyConfig = await collection.findOne({ server_id: interaction.guildId });
                const fullConfig = buildFullConfig(replyConfig?.server);

                let responseCode = `${inspect(fullConfig, { depth: 2, maxArrayLength: 10, maxStringLength: 200, breakLength: 2 })}`.replace('channels', 'Canais').replace('roles', 'Cargos').replace('preferences', 'Preferências');

                Object.keys(Server.optionLabels).forEach(key => {
                    responseCode = responseCode.replace(`${key.includes('.') ? key.split('.')[1] : key}`, Server.optionLabels[key]);
                });

                await interaction.channel.send({
                    content: `Você também pode configurar o ${botConfig.name} usando o painel de controle web, acesse: https://salazarbot.vercel.app/dashboard/${interaction.guildId}`
                });

                return await interaction.editReply({
                    flags: [MessageFlags.IsComponentsV2],
                    components: [
                        new ContainerBuilder()
                        .addTextDisplayComponents([
                            new TextDisplayBuilder()
                            .setContent(`## Configuração atual do servidor\n\n\`\`\`json\n${responseCode}\n\`\`\``)
                        ])
                        .setAccentColor(Colors.Blurple)
                    ]
                })
            }

            const value = interaction.options.get(Server.optionsAlike[option])?.value;

            if (!value && value !== false) return interaction.editReply({embeds: [
                new EmbedBuilder()
                .setDescription(`Para alterar o **${Server.optionLabels[option] || option}**, você precisa definir o argumento de **${Server.optionsAlike[option] || option}** no comando, e não o que você definiu.`)
                .setColor(Colors.Red)
            ]});

            // Busca referência da configuração
            const parts = option.split('.');
            let ref = Server.defaultConfiguration;
            for (const part of parts) {
                ref = ref?.[part];
            }

            // Validação do tipo
            if (ref?.onlyAccepts) {
                let isValid = false;
                for (const acceptedType of ref.onlyAccepts) {
                    if (
                        (acceptedType === String && typeof value === "string") ||
                        (acceptedType === Number && typeof value === "number") ||
                        (acceptedType === Boolean && typeof value === "boolean") ||
                        (typeof acceptedType === "number" && interaction.guild && interaction.guild.channels.cache.get(value)?.type === acceptedType) ||
                        (acceptedType.name && interaction.guild && interaction.guild.roles.cache.get(value)?.constructor?.name === acceptedType.name)
                    ) {
                        isValid = true;
                        break;
                    }
                }
                if (!isValid) {
                    return interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setDescription(`O valor informado para **${Server.optionLabels[option] || option}** não é do tipo aceito: **${ref.onlyAccepts.map(t => t.name || ChannelType[t] || t).join(', ')}**.`)
                                .setColor(Colors.Red)
                        ]
                    });
                }
            };

            let updateQuery;
            let action;
            let fakeValue;

            if (option.split('.')[0] == "name") fakeValue = value;
            else if (option.split('.')[0] == "channels") fakeValue = "<#"+value+">";
            else if (option.split('.')[0] == "roles") fakeValue = "<@&"+value+">";

            if (arrayOptions.includes(option)) {
                // Verifica se o valor já existe no array
                const current = serverConfig?.server?.[option.split('.')[0]]?.[option.split('.')[1]] || [];

                if (current.includes(value)) {
                    // Valor já existe → remove
                    updateQuery = { $pull: { [`server.${option}`]: value } };
                    action = `${fakeValue} removido de ${Server.optionLabels[option] || option}`;
                } else {
                    // Valor não existe → adiciona
                    updateQuery = { $push: { [`server.${option}`]: value } };
                    action = `${fakeValue} adicionado de ${Server.optionLabels[option] || option}`;
                }

            } else {
                // Campo simples → apenas set, mas se o valor já for igual ao atual, deixa undefined
                const currentValue = serverConfig?.server?.[option.split('.')[0]]?.[option.split('.')[1]] ?? serverConfig?.server?.[option];
                if (currentValue === value) {
                    updateQuery = { $set: { [`server.${option}`]: undefined } };
                    action = `${Server.optionLabels[option] || option} já estava definido como ${fakeValue}, valor removido (undefined)`;
                } else {
                    updateQuery = { $set: { [`server.${option}`]: value } };
                    action = `${Server.optionLabels[option] || option} redefinido para ${fakeValue}`;
                }
            }

            // Additional tasks
            switch (option) {
                case "channels.country_picking":
                    interaction.guild.channels.cache.get(value) &&
                    interaction.guild.channels.cache.get(value).send({
                        embeds: [
                            new EmbedBuilder()
                            .setDescription("Escolha com o que você vai jogar!")
                            .setColor(Colors.Blurple)
                        ],
                        components: [
                            new ActionRowBuilder()
                            .addComponents([
                                new ButtonBuilder()
                                .setStyle(ButtonStyle.Primary)
                                .setLabel('Selecionar seu país!')
                                .setCustomId('country_pick'),
                                new ButtonBuilder()
                                .setStyle(ButtonStyle.Secondary)
                                .setLabel('Sair do roleplay')
                                .setCustomId('country_leave')
                            ])
                        ]
                    });
                    break;
            
                default:
                    break;
            }

            const replyConfig = await collection.findOneAndUpdate(
                { server_id: interaction.guildId },
                updateQuery,
                { returnDocument: "after", upsert: true }
            );
            
            const updatedServerConfig = await Server.config(interaction.guildId);
            const fullConfig = buildFullConfig(updatedServerConfig?.server);

            let responseCode = `${inspect(JSON.parse(JSON.stringify(fullConfig)), { depth: 2 })}`.replace('channels', 'Canais').replace('roles', 'Cargos').replace('preferences', 'Preferências');

            Object.keys(Server.optionLabels).reverse().forEach(key => {
                responseCode = responseCode.replace(`${key.includes('.') ? key.split('.')[1] : key}`, Server.optionLabels[key]);
            });

            let embedFields = chunkifyText(responseCode, 1016, '\n```').map(chunk => {return {name: 'Configuração atual do servidor', value: "```json\n"+chunk}})

            arrayOptions.includes(option) && embedFields.push({name: 'Dica para configurações que aceitam mais de um valor', value: 'Você sabia que quando um elemento (tipo o Canais de Eventos) aceita múltiplos valores, você pode adicionar **ou remover** um valor da lista bastando usar o mesmo comando?'})
            option == "name" && embedFields.push({name: 'Dica pro nome do servidor', value: 'Se você colocar "{ano}" em alguma parte do nome, toda vez que o ano mudar, o nome do servidor será atualizado!'})

            await interaction.editReply({embeds: [
                new EmbedBuilder()
                .setTitle(`Configuração alterada com sucesso!`)
                .setColor(Colors.Green)
                .setDescription(action)
                .addFields(embedFields)
                .setTimestamp(interaction.createdAt)
            ]})

            await interaction.channel.send({
                content: `Você também pode configurar o ${botConfig.name} usando o painel de controle web, acesse: https://salazarbot.vercel.app/dashboard/${interaction.guildId}`
            });

        } catch (err) {
            console.error(err);
            await interaction.editReply(`Ocorreu um erro ao atualizar a configuração.`);
        } finally {
            await mongoClient.close();
        }
    },

    /**
     * @param {AutocompleteInteraction} interaction
     */
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        
        let choices;

        switch (focusedOption.name) {
            case 'opção':
                choices = Object.entries(Server.optionLabels).map(([key, label]) => ({
                    name: label,
                    value: key
                }))
                break;
        
            default:
                break;
        }

        const filtered = choices.filter(choice => choice.name.toLowerCase().includes(focusedOption.value.toLowerCase()) ).slice(0, 25);
        await interaction.respond(
            filtered.sort(),
        );
    }

}