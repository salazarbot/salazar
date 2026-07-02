import {
    ActionRowBuilder,
    ChannelSelectMenuBuilder,
    ChatInputCommandInteraction,
    SlashCommandBuilder,
    EmbedBuilder,
    Colors,
    RoleSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits
} from "discord.js";
import { MongoClient, ServerApiVersion } from "mongodb";
import botConfig from "../../config.json" with { type: "json" };
import * as Server from "../../src/Server.js";
import { deployCommands } from "../../src/Client.js";

export default {
    data: new SlashCommandBuilder()
        .setName("setup")
        .setDescription(`[Administrativo] Inicie o processo de instalação do ${botConfig.name} no seu servidor.`),

    setup_step: 0,
    disable_defer: true,

    /**
     * @param {ChatInputCommandInteraction} interaction
     */
    async execute(interaction) {

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
                content: `Você precisa ser um administrador para utilizar esse comando.`,
                ephemeral: true
            });
        }

        // Comece pedindo o nome do servidor via modal - RÁPIDO, sem await
        interaction.showModal(
            new ModalBuilder()
            .setCustomId('setup_server_name')
            .setTitle('Configuração - Nome do servidor')
            .addComponents(
                new ActionRowBuilder()
                .addComponents(
                    new TextInputBuilder()
                    .setCustomId('server_name_input')
                    .setLabel('Digite o nome do servidor')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Exemplo: Império do Norte - {ano}')
                    .setRequired(true)
                )
            )
        );

        const modalSubmit = await interaction.awaitModalSubmit({
            time: 5 * 60 * 1000,
            filter: (m) => m.user.id === interaction.user.id
        }).catch(() => null);

        if (!modalSubmit) {
            return interaction.followUp({
                content: "⏱ O setup foi cancelado por inatividade."
            });
        }
        
        const serverSetup = await Server.setup(interaction.guildId);

        const mongoClient = new MongoClient(process.env.DB_URI, {
            serverApi: {
                version: ServerApiVersion.v1,
                strict: true,
                deprecationErrors: true,
            },
        });

        let setupDate = serverSetup || {
            server_id: interaction.guildId,
            server_tier: 0,
            server: {}
        };

        if(!setupDate.server) setupDate.server = {};
        setupDate.server.channels = {};
        setupDate.server.roles = {};

        const serverName = modalSubmit.fields.getTextInputValue('server_name_input');
        setupDate.server.name = serverName;

        await modalSubmit.reply({
            content: `Nome do servidor salvo como: **${serverName}**!\nSe você usar \`{ano}\` no nome, o ${botConfig.name} atualizará automaticamente o nome do servidor toda vez que o ano passar!`,
        });

        // Agora segue para o primeiro seletor: cargo dos jogadores
        await modalSubmit.followUp({
            content: `Agora informe o **cargo dos jogadores**.`,
            components: [
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId("setup_player_role")
                        .setPlaceholder("Escolha o cargo dos jogadores")
                        .setMinValues(1)
                        .setMaxValues(1)
                )
            ]
        });
        
        modalSubmit.channel.send(`Seja rápido(a)! O setup será cancelado automaticamente <t:${Math.floor((Date.now() + 10 * 60 * 1000) / 1000)}:R>.`).catch(() => {});

        const collector = modalSubmit.channel.createMessageComponentCollector({
            filter: (i) => i.user.id === interaction.user.id,
            time: 10 * 60 * 1000
        });

        collector.on("collect", async (i) => {

            // Mapeamento de campos para validação
            const fieldMap = {
                "setup_player_role": { path: ["roles", "player"] },
                "setup_non_player_role": { path: ["roles", "non_player"] },
                "setup_admin_channel": { path: ["channels", "staff"] },
                "setup_logs_channel": { path: ["channels", "logs"] },
                "setup_context_channel": { path: ["channels", "context"] },
                "setup_narrations_channel": { path: ["channels", "narrations"] },
                "setup_time_channel": { path: ["channels", "time"] },
                "setup_secret_actions_channel": { path: ["channels", "secret_actions"] },
                "setup_secret_actions_log_channel": { path: ["channels", "secret_actions_log"] },
                "setup_events_channels": { path: ["channels", "events"], isArray: true },
                "setup_countries_category": { path: ["channels", "countries_category"] },
                "setup_country_picking_channel": { path: ["channels", "country_picking"] },
                "setup_picked_countries_channel": { path: ["channels", "picked_countries"] },
                "setup_actions_channels": { path: ["channels", "actions"], isArray: true }
            };

            // Validação de tipo usando onlyAccepts
            if (fieldMap[i.customId]) {
                let ref = Server.defaultConfiguration;
                for (const part of fieldMap[i.customId].path) {
                    ref = ref?.[part];
                }
                if (ref?.onlyAccepts) {
                    let values = fieldMap[i.customId].isArray ? i.values : [i.values[0]];
                    let isValid = values.every(val => {
                        return ref.onlyAccepts.some(acceptedType => {
                            if (acceptedType === String && typeof val === "string") return true;
                            if (acceptedType === Number && typeof val === "number") return true;
                            if (acceptedType === Boolean && typeof val === "boolean") return true;
                            // Para canais: acceptedType é um número (ChannelType), compare diretamente
                            if (typeof acceptedType === "number" && i.guild && i.guild.channels.cache.get(val)?.type === acceptedType) return true;
                            // Para cargos: acceptedType.name existe
                            if (acceptedType.name && i.guild && i.guild.roles.cache.get(val)?.constructor?.name === acceptedType.name) return true;
                            return false;
                        });
                    });
                    if (!isValid) {
                        await i.reply({
                            ephemeral: true,
                            embeds: [
                                new EmbedBuilder()
                                    .setDescription(`O valor informado não é do tipo aceito: **${ref.onlyAccepts.map(t => t.name || ChannelType[t] || t).join(', ')}**.`)
                                    .setColor(Colors.Red)
                            ]
                        });
                        return;
                    }
                }
            };

            // Processo padrão de configuração
            switch (i.customId) {
                case "setup_player_role":
                    setupDate.server.roles = {};
                    setupDate.server.roles.player = i.values[0];

                    await i.update({
                        content: `Agora informe o **cargo dos que não são jogadores**.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new RoleSelectMenuBuilder()
                                    .setCustomId("setup_non_player_role")
                                    .setPlaceholder("Escolha o cargo dos espectadores")
                                    .setMinValues(1)
                                    .setMaxValues(1)
                            )
                        ]
                    });
                    break;

                case "setup_non_player_role":
                    setupDate.server.roles.non_player = i.values[0];

                    await i.update({
                        content: `Agora selecione o **canal principal da administração**.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                    .setCustomId("setup_admin_channel")
                                    .setPlaceholder("Escolha o canal da administração")
                                    .setMinValues(1)
                                    .setMaxValues(1)
                            )
                        ]
                    });
                    break;

                case 'setup_admin_channel':
                    setupDate.server.channels.staff = i.values[0];

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de registros**, onde você poderá ver todos os registros detalhados do bot.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_logs_channel")
                                .setPlaceholder("Escolha o canal de logs")
                                .setMinValues(1)
                                .setMaxValues(1)
                            )
                        ]
                    });
                    break;

                case 'setup_logs_channel':
                    setupDate.server.channels.logs = i.values[0];

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **fórum de linha do tempo do roleplay (memória e contexto do bot)**. Esse canal será basicamente a enciclopédia do servidor, que o bot vai consultar INTEIRA antes de toda resposta que ele der.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_context_channel")
                                .setPlaceholder("Escolha o canal de contexto")
                                .setMinValues(1)
                                .setMaxValues(1)
                            )
                        ]
                    });
                    break;

                case 'setup_context_channel': {
                    setupDate.server.channels.context = i.values[0];

                    if (i.guild.channels.cache.get(i.values[0]).type == ChannelType.GuildForum) {
                        i.guild.channels.cache.get(i.values[0]).threads.create({
                            name: "Prólogo do RP",
                            reason: "Thread inicial do RP",
                            message: 'Olá! Esta é a thread inicial do roleplay. Aqui você pode adicionar informações importantes sobre o contexto do prólogo ou da história do servidor. O bot vai consultar este fórum inteiro antes de responder a qualquer ação dos jogadores.\n### Formato a ser seguido:\n```### Data do contexto\nResumo do acontecimento\n-# Países envolvidos```',
                        })
                    } else {
                        await i.message?.edit({
                            content: `Setup em andamento...`,
                            components: []
                        });
                        console.log(i.guild.channels.cache.get(i.values[0]).type);
                        return await i.update({
                            content: `Inválido! Precisa ser um fórum. Por favor, selecione o **fórum de linha do tempo do roleplay (memória e contexto do bot)**. Esse canal será basicamente a enciclopédia do servidor, que o bot vai consultar INTEIRA antes de toda resposta que ele der.`,
                            components: [
                                new ActionRowBuilder().addComponents(
                                    new ChannelSelectMenuBuilder()
                                    .setCustomId("setup_context_channel")
                                    .setPlaceholder("Escolha o canal de contexto")
                                    .setMinValues(1)
                                    .setMaxValues(1)
                                )
                            ]
                        });
                    };

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de narrações**. Toda ação que um jogador fizer, que se encaixe no mínimo de 500 caracteres, o ${botConfig.name} vai narrar e publicar lá as narrações`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_narrations_channel")
                                .setPlaceholder("Escolha o canal de narrações")
                                .setMinValues(1)
                                .setMaxValues(1)
                            )
                        ]
                    });
                    break;
                };
                
                case "setup_narrations_channel":
                    setupDate.server.channels.narrations = i.values[0];

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de passagem de tempo**. O chat em que você anuncia toda vez que o ano, semestre, ou período acaba. (O ${botConfig.name} não vai passar o ano contra sua vontade! Isso é só pra ele atualizar o tempo)`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_time_channel")
                                .setPlaceholder("Escolha o canal de passagem de tempo")
                                .setMinValues(1)
                                .setMaxValues(1)
                            )
                        ]
                    });
                    break;
                
                case "setup_time_channel":
                    setupDate.server.channels.time = i.values[0];

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de ações secretas**. Toda vez que um jogador fizer uma ação nesse chat, ela será apagada e reenviada num canal específico (que somente a administração deve poder ver, para poder narrar), mantendo segredo dos outros jogadores.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_secret_actions_channel")
                                .setPlaceholder("Escolha o canal de ações secretas")
                                .setMinValues(1)
                                .setMaxValues(1)
                            ),
                            new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                .setCustomId("setup_skip_secret_actions_log_channel")
                                .setLabel("Pular (não quero ações secretas)")
                                .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    break;

                case "setup_secret_actions_channel":
                    setupDate.server.channels.secret_actions = i.values[0];

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de registro de ações secretas**. Esse é o canal administrativo em que o bot vai reenviar as ações secretas, para serem narradas discretamente.`,
                        components: [
                            new ActionRowBuilder()
                            .addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_secret_actions_log_channel")
                                .setPlaceholder("Escolha o registro de ações secretas")
                                .setMinValues(1)
                                .setMaxValues(1)
                            )
                        ]
                    });
                    break;

                case "setup_secret_actions_log_channel":
                    setupDate.server.channels.secret_actions_log = i.values[0];

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione os **canais de eventos**. Esses canais são canais como de notícias, guerras, etc. Qualquer mensagem (que tenha um mínimo de 300 caracteres) enviada nesses canais será considerada um evento real, e o bot irá registrar no resumo do RP (sua memória) e considerar para narrações.\n-# Selecione de 1-15 canais. Pode incluir categorias também. Nesse caso, todos os canais dentro da categoria serão considerados.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_events_channels")
                                .setPlaceholder("Todos os canais de eventos")
                                .setMinValues(1)
                                .setMaxValues(15)
                            )
                        ]
                    });
                    break;
                
                case "setup_skip_secret_actions_log_channel":
                    setupDate.server.channels.secret_actions_log = null;
                    setupDate.server.channels.secret_actions_log_channel = null;
                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione os **canais de eventos**. Esses canais são canais como de notícias, guerras, etc. Qualquer mensagem (que tenha um mínimo de 300 caracteres) enviada nesses canais será considerada um evento real, e o bot irá registrar no resumo do RP (sua memória) e considerar para narrações.\n-# Selecione de 1-15 canais. Pode incluir categorias também. Nesse caso, todos os canais dentro da categoria serão considerados.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_events_channels")
                                .setPlaceholder("Todos os canais de eventos")
                                .setMinValues(1)
                                .setMaxValues(15)
                            )
                        ]
                    });
                    break;

                case "setup_events_channels":
                    setupDate.server.channels.events = i.values;

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione a **categoria dos canais de países**. Essa categoria é a que contém os canais específicos de país onde os jogadores podem gerenciar seus países, e o bot irá monitorar as mensagens para registrar ações e eventos relacionados aos países.\n-# Selecione a categoria que contenha os canais de países.`,
                        components: [
                            new ActionRowBuilder()
                            .addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_countries_category")
                                .setPlaceholder("Categoria dos canais de países")
                                .setMinValues(1)
                                .setMaxValues(1)
                            ),
                            new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                .setCustomId("setup_skip_countries_category")
                                .setLabel("Pular (meu servidor não tem chats privados de países)")
                                .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    break;
                
                case "setup_skip_countries_category":
                    setupDate.server.channels.countries_category = null;
                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de escolha de país**. Esse é o canal onde os jogadores escolhem seus países no início do jogo. O bot irá monitorar esse canal para registrar as escolhas dos jogadores.`,
                        components: [
                            new ActionRowBuilder()
                            .addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_country_picking_channel")
                                .setPlaceholder("Canal de escolha de país")
                                .setMinValues(1)
                                .setMaxValues(1)
                            ),
                            new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                .setCustomId("setup_skip_country_picking_channel")
                                .setLabel("Pular (não quero automatizar a escolha de país)")
                                .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    break;

                case "setup_countries_category":
                    setupDate.server.channels.countries_category = i.values[0];
                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de escolha de país**. Esse é o canal onde os jogadores escolhem seus países no início do jogo. O bot irá monitorar esse canal para registrar as escolhas dos jogadores.`,
                        components: [
                            new ActionRowBuilder()
                            .addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_country_picking_channel")
                                .setPlaceholder("Canal de escolha de país")
                                .setMinValues(1)
                                .setMaxValues(1)
                            ),
                            new ActionRowBuilder()
                            .addComponents(
                                new ButtonBuilder()
                                .setCustomId("setup_skip_country_picking_channel")
                                .setLabel("Pular (não quero automatizar a escolha de país)")
                                .setStyle(ButtonStyle.Secondary)
                            )
                        ]
                    });
                    break;
                
                case "setup_skip_country_picking_channel":
                    setupDate.server.channels.country_picking = null;

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione os **canais de ações**. Estes são os canais em que os jogadores jogam, basicamente. Qualquer mensagem de mais de 500 caracteres enviada por um jogador em um destes chats será considerada uma ação, e seus resultados serão narrados. \n-# Selecione de 1-15 canais. Pode incluir categorias também. Nesse caso, todos os canais dentro da categoria serão considerados.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_actions_channels")
                                .setPlaceholder("Todos os canais de ações")
                                .setMinValues(1)
                                .setMaxValues(15)
                            )
                        ]
                    });
                    break;

                case "setup_country_picking_channel":
                    setupDate.server.channels.country_picking = i.values[0];

                    i.guild.channels.cache.get(i.values[0]).send({
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

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione o **canal de países escolhidos**. Basicamente, o Salazar vai registrar nesse canal quais países foram escolhidos pelos jogadores.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_picked_countries_channel")
                                .setPlaceholder("Canal de países escolhidos")
                                .setMinValues(1)
                                .setMaxValues(1)
                            )
                        ]
                    });
                    break;
                
                case "setup_picked_countries_channel":
                    setupDate.server.channels.picked_countries = i.values[0];

                    await i.message?.edit({
                        content: `Setup em andamento...`,
                        components: []
                    });
                    await i.update({
                        content: `Agora selecione os **canais de ações**. Estes são os canais em que os jogadores jogam, basicamente. Qualquer mensagem de mais de 500 caracteres enviada por um jogador em um destes chats será considerada uma ação, e seus resultados serão narrados. \n-# Selecione de 1-15 canais. Pode incluir categorias também. Nesse caso, todos os canais dentro da categoria serão considerados.`,
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ChannelSelectMenuBuilder()
                                .setCustomId("setup_actions_channels")
                                .setPlaceholder("Todos os canais de ações")
                                .setMinValues(1)
                                .setMaxValues(15)
                            )
                        ]
                    });
                    break;

                case "setup_actions_channels":
                    setupDate.server.channels.actions = i.values;

                    await i.update({
                        content: `Finalizando setup...`,
                        components: []
                    });

                    delete setupDate.server_setup_step;

                    try {
                        await mongoClient.connect();

                        await mongoClient.db("Salazar").collection("configuration").updateOne(
                            { server_id: interaction.guildId },
                            { $set: setupDate },
                            { upsert: true }
                        );

                        await mongoClient.db('Salazar').collection('setup').deleteOne({ server_id: interaction.guildId });

                        await i.followUp({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle("Setup concluído!")
                                    .setColor(Colors.Green)
                                    .setDescription(`O **${botConfig.name}** foi configurado com sucesso neste servidor`)
                                    .addFields([
                                        {
                                            name: 'Continue configurando!',
                                            value: `Você pode configurar o bot ainda mais usando o site https://salazarbot.vercel.app/dashboard/${interaction.guildId} (ou o comando \`/configuração\`). Muitas configurações extras como **prompt adicional** e **tempo para envio de todas as partes da ação** estão disponíveis apenas lá, fora todas as opções do setup.`,
                                            inline: true
                                        }
                                    ])
                                    .setTimestamp(new Date())
                            ]
                        });

                    } catch (err) {
                        console.error(err);
                        await i.followUp({
                            content: `❌ Ocorreu um erro ao salvar a configuração.`
                        });
                    } finally {
                        await mongoClient.close();
                    }

                    collector.stop("completed");
                    deployCommands(collector.guildId);
                    break;

                default:
                    break;
            };
            
        });

        collector.on("end", (collected, reason) => {
            if (reason !== "completed") {
                interaction.followUp({
                    content: "⏱ O setup foi cancelado por inatividade."
                }).catch(() => {});
            }
        });
    }
}
