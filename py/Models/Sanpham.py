from pydantic import BaseModel

class Sanpham(BaseModel):
    id: int
    name: str
    price: float
    quantily: int
