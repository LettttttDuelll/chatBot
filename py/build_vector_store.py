import os
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from langchain_community.document_loaders import TextLoader, PyPDFLoader
from langchain_community.embeddings import OllamaEmbeddings

DATA_DIR = "rag_data"
DB_DIR = "rag_db"

def load_documents():
    docs = []
    for root, _, files in os.walk(DATA_DIR):
        for name in files:
            path = os.path.join(root, name)
            ext = os.path.splitext(name)[1].lower()
            if ext == ".pdf":
                loader = PyPDFLoader(path)
            else:
                loader = TextLoader(path, encoding="utf-8")
            docs.extend(loader.load())
    return docs

def main():
    documents = load_documents()
    if not documents:
        raise SystemExit("No documents found in rag_data")

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
    texts = splitter.split_documents(documents)

    embeddings = OllamaEmbeddings(model="mxbai-embed-large")
    Chroma.from_documents(texts, embeddings, persist_directory=DB_DIR)
    print(f"Indexed {len(texts)} chunks into {DB_DIR}")

if __name__ == "__main__":
    main()
