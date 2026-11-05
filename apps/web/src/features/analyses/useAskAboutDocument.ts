import * as React from "react";
import { useNavigate } from "react-router";
import { useCreateConversation } from "@/features/chat/hooks";

/**
 * Cria uma conversa restrita a um documento e navega para ela com a pergunta inicial;
 * a página do chat envia a mensagem (via streaming) ao detectar `state.firstMessage`.
 */
export function useAskAboutDocument(documentId: string) {
  const navigate = useNavigate();
  const create = useCreateConversation();

  const ask = React.useCallback(
    async (question: string) => {
      const conv = await create.mutateAsync({ document_ids: [documentId], collection_ids: [] });
      navigate(`/chat/${conv.id}`, { state: { firstMessage: question } });
      return conv;
    },
    [create, documentId, navigate],
  );

  return { ask, isPending: create.isPending, error: create.error };
}
