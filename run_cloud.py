"""Cloud host provides PORT; only the gateway is publicly bound."""
import os
import uvicorn

if __name__=='__main__':
    uvicorn.run('cloud_gateway:app',host=os.getenv('CLOUD_HOST','0.0.0.0'),
                port=int(os.getenv('PORT','10000')),workers=1)
