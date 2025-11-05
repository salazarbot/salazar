import * as Discord from "discord.js";
import { 
    SlashCommandBuilder, 
    SlashCommandStringOption, 
    EmbedBuilder, 
    Colors,
    ChatInputCommandInteraction
} from "discord.js";
import { inspect } from "util";
import botConfig from "../../config.json" with { type: "json" };
import { GoogleGenAI } from "@google/genai";
import 'dotenv/config';
import Canvas from "canvas";
import fs from "fs";
import path from "path";
import * as Server from "../../src/Server.js";
import projectPackage from "../../package.json" with { type: "json" };
import client, { announce } from "../../src/Client.js";
import * as Roleplay from "../../src/Roleplay.js";
import { aiGenerate, sendRequisition } from "../../src/AIUtils.js";
import {
    chunkifyText,
    simplifyString
} from "../../src/StringUtils.js";
import {
    getAverageColor,
    fetchImageAsPngBuffer,
    isImageSafe,
    makeRoundFlag
} from "../../src/VisualUtils.js";
import gis from "g-i-s";

// Constantes para configuração
const MAX_FIELD_LENGTH = 1014;
const SYNC_TIMEOUT = 30_000; // 30 segundos
const ASYNC_TIMEOUT = 60_000; // 60 segundos

/**
 * Formata a saída para exibição melhorada
 * @param {any} output - Saída a ser formatada
 * @param {number} maxLength - Tamanho máximo da string
 * @returns {string} - Saída formatada
 */
function formatOutput(output, maxLength = MAX_FIELD_LENGTH) {
    try {
        let formatted;
        
        if (output === undefined) {
            formatted = "undefined";
        } else if (output === null) {
            formatted = "null";
        } else if (typeof output === 'string') {
            formatted = output;
        } else if (typeof output === 'function') {
            formatted = `[Function: ${output.name || 'anonymous'}]`;
        } else if (output instanceof Promise) {
            formatted = "[Promise] (use await para resolver)";
        } else if (output instanceof Error) {
            formatted = `${output.name}: ${output.message}\n${output.stack?.split('\n').slice(0, 3).join('\n') || ''}`;
        } else if (typeof output === 'object') {
            // Fallback para inspect se JSON.stringify falhar
            formatted = inspect(output, { 
                depth: 0, 
                colors: false, 
                maxArrayLength: 10,
                maxStringLength: 200,
                breakLength: 80,
                compact: false,
                showHidden: false
            });
        } else {
            formatted = String(output);
        }

        // Limita o tamanho da saída
        if (formatted.length > maxLength) {
            const truncatePoint = maxLength - 50;
            formatted = formatted.slice(0, truncatePoint) + "\n\n... (truncado - resultado muito longo)";
        }

        return formatted;
    } catch (error) {
        return `[Erro ao formatar saída]: ${error.message}`;
    }
}

/**
 * Cria um timeout promise para cancelar execuções longas
 * @param {number} ms - Milissegundos para timeout
 * @returns {Promise} - Promise que rejeita após o timeout
 */
function createTimeoutPromise(ms) {
    return new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`⏰ Timeout: Execução cancelada após ${ms/1000} segundos`)), ms)
    );
}

/**
 * Executa código JavaScript usando eval direto com acesso total ao escopo
 * @param {string} code - Código a ser executado
 * @returns {Promise<{output: any, success: boolean, executionTime: number, isAsync: boolean}>}
 */
async function executeCode(code, interaction) {
    const startTime = process.hrtime.bigint();
    let output;
    let success = true;
    let isAsync = false;

    try {
        // Detecta se o código é assíncrono
        const asyncPattern = /\b(await|async)\b/;
        isAsync = asyncPattern.test(code);

        let result;
        
        if (isAsync) {
            // Para código assíncrono usando eval
            result = await Promise.race([
                eval(`(async () => { ${code} })()`),
                createTimeoutPromise(ASYNC_TIMEOUT)
            ]);
        } else {
            // Para código síncrono usando eval
            result = eval(code);
            
            // Se retornou uma Promise, resolve ela com timeout
            if (result instanceof Promise) {
                result = await Promise.race([
                    result,
                    createTimeoutPromise(SYNC_TIMEOUT)
                ]);
            }
        }
        
        output = result;
        
    } catch (error) {
        output = error;
        success = false;
    }

    const endTime = process.hrtime.bigint();
    const executionTime = Number(endTime - startTime) / 1_000_000;

    return {
        output,
        success,
        executionTime,
        isAsync
    };
}

/**
 * Trunca texto para caber nos limites do Discord
 * @param {string} text - Texto para truncar
 * @param {number} maxLength - Tamanho máximo
 * @returns {string} - Texto truncado
 */
function truncateForDiscord(text, maxLength = MAX_FIELD_LENGTH) {
    if (text.length <= maxLength) return text;
    
    const truncatePoint = maxLength - 20;
    return text.slice(0, truncatePoint) + "\n... (truncado)";
}

/**
 * Cria embed de sucesso para resultado da execução
 * @param {string} code - Código executado
 * @param {any} output - Resultado da execução
 * @param {number} executionTime - Tempo de execução em ms
 * @param {boolean} isAsync - Se o código era assíncrono
 * @returns {EmbedBuilder} - Embed formatado
 */
function createSuccessEmbed(code, output, executionTime, isAsync) {
    const formattedOutput = formatOutput(output);
    
    return new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle(`✅ Código ${isAsync ? 'assíncrono' : 'síncrono'} executado com sucesso`)
        .addFields([
            {
                name: '📥 Entrada',
                value: `\`\`\`js\n${truncateForDiscord(code)}\n\`\`\``
            },
            {
                name: '📤 Saída',
                value: `\`\`\`js\n${truncateForDiscord(formattedOutput)}\n\`\`\``
            }
        ])
        .setTimestamp()
        .setFooter({ text: `${output === null ? 'null' : typeof output} obtido em ${Math.round(executionTime*100)}ms` });
}

/**
 * Cria embed de erro para falha na execução
 * @param {string} code - Código que falhou
 * @param {Error|any} error - Erro ocorrido
 * @param {number} executionTime - Tempo de execução em ms
 * @returns {EmbedBuilder} - Embed formatado
 */
function createErrorEmbed(code, error, executionTime) {
    const formattedError = formatOutput(error);
    
    return new EmbedBuilder()
        .setColor(Colors.Red)
        .setTitle('❌ Erro na execução do código')
        .addFields([
            {
                name: '📥 Entrada',
                value: `\`\`\`js\n${truncateForDiscord(code)}\n\`\`\``
            },
            {
                name: '🚫 Erro',
                value: `\`\`\`js\n${truncateForDiscord(formattedError)}\n\`\`\``
            }
        ])
        .setTimestamp()
        .setFooter({ text: `${error?.name || 'Erro desconhecido'} detectado em ${Math.round(executionTime*100)}ms.` });
}

export default {
    data: new SlashCommandBuilder()
    .setName("eval")
    .setDescription("[Desenvolvedor] Executa código JavaScript diretamente pelo Discord")
    .addStringOption(
        new SlashCommandStringOption()
        .setName("código")
        .setDescription("Código JavaScript para executar")
        .setRequired(true)
    ),

    setup_step: -1,
    ephemeral: true,

    /**
     * @param {ChatInputCommandInteraction} interaction 
     */
    async execute(interaction) {
        // Verifica permissão
        if (!botConfig.owners?.includes(interaction.user.id)) {
            return await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(Colors.Red)
                        .setTitle("🚫 Acesso negado")
                        .setDescription("Este comando é restrito aos desenvolvedores do bot.")
                        .setTimestamp()
                ]
            });
        };

        const code = interaction.options.getString("código");

        // Validação básica do código
        if (!code || code.trim().length === 0) {
            return await interaction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(Colors.Orange)
                        .setTitle("⚠️ Código inválido")
                        .setDescription("O código fornecido está vazio ou inválido.")
                ]
            });
        };

        try {
            // Executa o código
            const { output, success, executionTime, isAsync } = await executeCode(code, interaction);

            let embed;
            
            if (success) {
                embed = createSuccessEmbed(code, output, executionTime, isAsync);
            } else {
                embed = createErrorEmbed(code, output, executionTime);
            };

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("Erro crítico no eval:", error);
            
            // Embed para erro crítico do sistema
            const criticalErrorEmbed = new EmbedBuilder()
                .setColor(Colors.DarkRed)
                .setTitle("💥 Erro crítico do sistema")
                .setDescription("Falha interna no sistema de execução. Verifique os logs do console.")
                .addFields([
                    {
                        name: '📥 Código tentado',
                        value: `\`\`\`js\n${truncateForDiscord(code)}\n\`\`\``
                    },
                    {
                        name: "🔧 Detalhes técnicos",
                        value: `\`\`\`js\n${truncateForDiscord(error.message || 'Erro desconhecido')}\n\`\`\``
                    }
                ])
                .setTimestamp()

            await interaction.editReply({ embeds: [criticalErrorEmbed] }).catch(console.error);
        };
    }
};