import * as React from "react";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { DocumentList } from "@/features/documents/DocumentList";
import { UploadDropzone } from "@/features/documents/UploadDropzone";
import { useMe } from "@/features/auth/hooks";

export function DocumentsPage() {
  const { data: user } = useMe();
  const canManage = user?.workspace.role === "admin" || user?.workspace.role === "editor";
  const [showUpload, setShowUpload] = React.useState(true);
  const uploadRef = React.useRef<HTMLDivElement>(null);

  const focusUpload = () => {
    setShowUpload(true);
    window.setTimeout(() => uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <div>
      <PageHeader
        title="Biblioteca de Documentos"
        description="Envie PDFs, acompanhe o processamento real e abra os documentos indexados."
        actions={
          canManage ? (
            <Button variant={showUpload ? "outline" : "gradient"} onClick={() => setShowUpload((v) => !v)}>
              <Upload /> {showUpload ? "Ocultar envio" : "Enviar documento"}
            </Button>
          ) : null
        }
      />
      {canManage && showUpload ? (
        <div ref={uploadRef} className="mb-6">
          <UploadDropzone />
        </div>
      ) : null}
      <DocumentList canManage={!!canManage} onUploadClick={canManage ? focusUpload : undefined} />
    </div>
  );
}
