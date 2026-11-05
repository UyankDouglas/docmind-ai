import * as React from "react";
import { useParams } from "react-router";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { CollectionColorDot, CollectionsPanel } from "@/features/collections/CollectionsPanel";
import { useCollection } from "@/features/collections/hooks";
import { DocumentList } from "@/features/documents/DocumentList";
import { UploadDropzone } from "@/features/documents/UploadDropzone";
import { useMe } from "@/features/auth/hooks";
import { UsageBlockBanner } from "@/features/settings/UsageBlockBanner";

export function DocumentsPage() {
  const { collectionId } = useParams<{ collectionId?: string }>();
  const { data: user } = useMe();
  const collection = useCollection(collectionId);
  const canManage = user?.workspace.role === "admin" || user?.workspace.role === "editor";
  const [showUpload, setShowUpload] = React.useState(true);
  const uploadRef = React.useRef<HTMLDivElement>(null);

  const focusUpload = () => {
    setShowUpload(true);
    window.setTimeout(() => uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const title = collectionId ? (
    <span className="inline-flex items-center gap-2">
      <CollectionColorDot color={collection.data?.color ?? null} className="size-3" />
      {collection.data?.name ?? "Coleção"}
    </span>
  ) : (
    "Biblioteca de Documentos"
  );
  const description = collectionId
    ? (collection.data?.description ?? `${collection.data?.document_count ?? 0} documento(s) nesta coleção.`)
    : "Envie PDFs, DOCX e TXT, organize por coleções e tags, acompanhe o processamento real e abra os documentos indexados.";

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          canManage ? (
            <Button variant={showUpload ? "outline" : "gradient"} onClick={() => setShowUpload((v) => !v)}>
              <Upload /> {showUpload ? "Ocultar envio" : "Enviar documento"}
            </Button>
          ) : null
        }
      />
      <UsageBlockBanner />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <CollectionsPanel canManage={!!canManage} activeId={collectionId} className="h-fit lg:sticky lg:top-20" />
        <div className="min-w-0">
          {canManage && showUpload ? (
            <div ref={uploadRef} className="mb-6">
              <UploadDropzone key={collectionId ?? "all"} defaultCollectionId={collectionId ?? null} />
            </div>
          ) : null}
          <DocumentList key={collectionId ?? "all"} canManage={!!canManage} onUploadClick={canManage ? focusUpload : undefined} collectionId={collectionId ?? null} />
        </div>
      </div>
    </div>
  );
}
