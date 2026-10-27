# ADR 0002 — Seleção por provedores desacoplados

O NestJS mantém a seleção, sem acoplar inferência ao worker de mídia. Provedores
implementam `LlmProvider`, com estimativa de pior custo, geração e consumo opcional.
O padrão mock é uma heurística determinística para testes, sem qualidade semântica
de um LLM real. O adaptador Ollama usa API de chat local e saída estruturada,
desabilitado por padrão. Não há integração de cobrança ou chamada paga habilitada.

O modelo escolhe IDs de segmentos; o servidor deriva os timestamps da transcrição.
Isso evita tempos inventados. Entrada leva texto e segmentos compactos, sem palavras
individualizadas, evidências, credenciais ou mídia. Blocos têm sobreposição limitada
para preservar contexto sem repetir a transcrição inteira. UTF-8 em bytes é uma
estimativa conservadora para reserva, não uma medição de tokens do modelo.

Pontuação: gancho 35%, contexto 25%, valor 25% e clareza 15%, cada nota de 0 a 10.
São sugestões editoriais, não garantias de desempenho. O pós-processamento filtra
baixa nota, sobreposição temporal >=65% do menor corte e similaridade textual
Jaccard >=80%. Títulos e descrições são propostos com base na fala, sujeitos a revisão.

Custos são inteiros em milionésimos de USD (1 USD = 1.000.000). Um provedor sem
estimativa confiável deve ser bloqueado antes do envio. Métricas ausentes ficam
desconhecidas; não são convertidas em consumo zero. Falhas de rede não permitem
liberar uma reserva cujo faturamento possa ter ocorrido.
