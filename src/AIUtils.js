import { GenerateContentResponse, GoogleGenAI, createUserContent } from "@google/genai";
import botConfig from "../config.json" with { type: "json" };
import 'dotenv/config';

export const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

/**
 * Detecta o tipo MIME da imagem com base na URL ou dados
 * @param {string} imageUrl - URL da imagem
 * @returns {string} - Tipo MIME detectado
 */
function detectMimeType(imageUrl) {
  const extension = imageUrl.toLowerCase().split('.').pop().split('?')[0];
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp'
  };
  return mimeTypes[extension] || 'image/png';
}

/**
 * Processa uma única imagem para inclusão no conteúdo
 * @param {string} imageUrl - URL da imagem
 * @returns {Promise<Object>} - Objeto com dados da imagem processada
 */
async function processImage(imageUrl) {
  try {
    const imageResponse = await fetch(imageUrl);
    
    if (!imageResponse.ok) {
      throw new Error(`Falha ao buscar imagem: ${imageResponse.status} ${imageResponse.statusText}`);
    }

    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const base64ImageData = Buffer.from(imageArrayBuffer).toString('base64');
    const mimeType = detectMimeType(imageUrl);

    return {
      inlineData: {
        mimeType,
        data: base64ImageData,
      },
    };
  } catch (error) {
    console.error(`Erro ao processar imagem ${imageUrl}:`, error.message);
    throw new Error(`Falha ao processar imagem: ${error.message}`);
  }
}

/**
 * Processa múltiplas imagens em paralelo
 * @param {string[]} imageUrls - Array de URLs das imagens
 * @returns {Promise<Object[]>} - Array com dados das imagens processadas
 */
async function processImages(imageUrls) {
  const imagePromises = imageUrls.map(processImage);
  return Promise.all(imagePromises);
}

/**
 * Envia uma requisição para a IA.
 * @param {string} prompt - O prompt a ser enviado para a IA
 * @param {string} model - O modelo de IA a ser utilizado
 * @param {string|string[]} [imageUrls] - URL(s) da(s) imagem(ns) para analisar
 * @returns {Promise<GenerateContentResponse>} - A resposta da IA
 * @throws {Error} - Se ocorrer um erro ao enviar a requisição
 */
export async function sendRequisition(prompt, model, imageUrls = undefined) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error("O prompt deve ser uma string não vazia");
  }

  if (!model || typeof model !== 'string') {
    throw new Error("O modelo deve ser uma string não vazia");
  }

  try {
    let contents;

    if (imageUrls && (Array.isArray(imageUrls) ? imageUrls.length > 0 : imageUrls)) {

      try {

        // Normaliza imageUrls para array
        const urlArray = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
        
        // Filtra URLs válidas
        const validUrls = urlArray.filter(url => url && typeof url === 'string');
        
        if (validUrls.length === 0) {
          contents = createUserContent(prompt);
        } else {
          // Processa imagens
          const processedImages = await processImages(validUrls);
          
          // Cria conteúdo com texto e imagens
          const userContent = [prompt, ...processedImages];
          contents = createUserContent(userContent);
        }

      } catch (err) {
        // Apenas texto
        console.error(`-- Ignorando imagens devido ao erro: `, err?.message);
        contents = createUserContent(prompt);
      }

    } else {
      // Apenas texto
      contents = prompt;
    }

    const response = await ai.models.generateContent({
      model,
      contents,
    });

    console.log(`-- ${botConfig.name} está usando o modelo ${model}`);

    return response;
  } catch (error) {
    throw error;
  }
}

/**
 * Gera uma resposta da IA com base no prompt fornecido, tentando todos os modelos em ordem.
 * @param {string} prompt - O prompt a ser enviado para a IA
 * @param {string|string[]} [imageUrls] - URL(s) da(s) imagem(ns) para analisar
 * @returns {Promise<GenerateContentResponse>} - A resposta da IA
 * @throws {Error} - Se o prompt for inválido ou se ocorrer um erro na geração
 */
export async function aiGenerate(prompt, imageUrls = undefined) {

  if (!prompt || typeof prompt !== 'string') {
    throw new Error("O prompt deve ser uma string não vazia");
  }

  // Validação da configuração
  if (!botConfig.model) {
    throw new Error("Configuração de modelo não encontrada em botConfig");
  }

  const models = botConfig?.model;
  
  if (!models || models.length === 0) {
    throw new Error("Nenhum modelo configurado");
  }

  const errors = [];
  
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    
    try {
      
      const response = await sendRequisition(prompt, model, imageUrls);
      
      return response;
      
    } catch (error) {
      const errorMessage = `Modelo ${model}: ${error.message}`;
      errors.push(errorMessage);
      
      // Se não é o último modelo, continua tentando
      if (i < models.length - 1) {
        continue;
      }
    }
  }

  // Se chegou aqui, todos os modelos falharam
  const fullErrorMessage = `Falha em todos os modelos:\n${errors.join('\n')}`;
  console.error("Erro ao gerar resposta da IA:", fullErrorMessage);
  
  throw new Error(`Não foi possível obter resposta da IA. Tentativas falharam: ${errors.length}`);
}