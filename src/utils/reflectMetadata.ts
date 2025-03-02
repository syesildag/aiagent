export default class ReflectMetadata {

   private static readonly metadataSymbol = Symbol.for("metadata");

   private static getOrCreateMetadata(target: any) {
      let properties;
      if (Object.prototype.hasOwnProperty.call(target, ReflectMetadata.metadataSymbol))
         properties = target[ReflectMetadata.metadataSymbol];

      else
         properties = target[ReflectMetadata.metadataSymbol] = {};
      return properties;
   }

   static getMetadata(metadataKey: any, target: any): any {
      return ReflectMetadata.getOrCreateMetadata(target)[metadataKey];
   }

   static defineMetadata(metadataKey: any, metadataValue: any, target: any) {
      ReflectMetadata.getOrCreateMetadata(target)[metadataKey] = metadataValue;
   }
}