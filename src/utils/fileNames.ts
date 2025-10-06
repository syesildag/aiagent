import fs from 'fs';

export function getFileNamesFromDirSync(srcDir: string) {
   return fs
      .readdirSync(srcDir, { withFileTypes: true })
      .filter(file => file.isFile());
}

export function getAbsoluteFileNamesFromDirSync(srcDir: string) {
   return getFileNamesFromDirSync(srcDir)
      .map(file => `${srcDir}/${file.name}`);
}

export function getFileNamesFromDir(srcDir: string): Promise<fs.Dirent[]> {
   return new Promise((resolve, reject) => {
      fs.readdir(srcDir, { withFileTypes: true }, (err, files) => {
         if (err)
            reject(err);
         else
            resolve(files.filter(file => file.isFile()));
      });
   });
}

export async function getAbsoluteFileNamesFromDir(srcDir: string) {
   return (await getFileNamesFromDir(srcDir))
   .map(file => `${srcDir}/${file.name}`);
}
