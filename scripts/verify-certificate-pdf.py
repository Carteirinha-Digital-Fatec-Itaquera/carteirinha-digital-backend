import sys
import argparse

def main():
    parser = argparse.ArgumentParser(description="Verificador de PDF e QR Code de Certificado")
    parser.add_argument("pdf_path", help="Caminho para o arquivo PDF")
    parser.add_argument("--expected-url", help="URL esperada codificada no QR Code")
    args = parser.parse_args()

    try:
        import fitz  # PyMuPDF
        import cv2
        import numpy as np
    except ImportError as e:
        print(f"Dependência ausente para teste completo do PDF ({e}). Instale via requirements-pdf-tests.txt.", file=sys.stderr)
        sys.exit(0)

    try:
        doc = fitz.open(args.pdf_path)
    except Exception as e:
        print(f"ERRO: Falha ao abrir o PDF: {e}", file=sys.stderr)
        sys.exit(1)

    if len(doc) == 0:
        print("ERRO: PDF vazio", file=sys.stderr)
        sys.exit(1)

    page = doc[0]
    pix = page.get_pixmap(dpi=250)
    img_data = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        img_data = cv2.cvtColor(img_data, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:
        img_data = cv2.cvtColor(img_data, cv2.COLOR_RGB2BGR)

    detector = cv2.QRCodeDetector()
    data, bbox, _ = detector.detectAndDecode(img_data)

    if not data:
        print("ERRO: QR Code não detectado na página renderizada", file=sys.stderr)
        sys.exit(2)

    print(f"QR Code detectado com sucesso: {data}")

    if args.expected_url and data != args.expected_url:
        print(f"ERRO: URL do QR Code ({data}) difere da esperada ({args.expected_url})", file=sys.stderr)
        sys.exit(3)

    print("Verificação concluída com sucesso!")
    sys.exit(0)

if __name__ == "__main__":
    main()
