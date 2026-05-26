# Download and install Chocolatey:
powershell -c "irm https://community.chocolatey.org/install.ps1|iex"

# Download and install Node.js:
choco install nodejs --version="24.16.0"

# Verify the Node.js version:
node -v # Should print "v24.16.0".

# Verify npm version:
npm -v # Should print "11.13.0".
  

cmd.exe /c "set PATH=C:\Program Files\nodejs;%PATH% && cd /d C:\Users\Cromwel\OneDrive\Desktop\New folder && npm start"  